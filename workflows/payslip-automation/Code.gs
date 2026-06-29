/**
 * 코리아스픽스 급여명세서 발급 자동화 — "별동수"
 * ------------------------------------------------------------------
 * 2026_sal 스프레드시트에 바인딩되는 Google Apps Script.
 * Autocrat가 하던 "머지 → PDF → 발송"을 같은 템플릿으로 직접 수행한다.
 *
 * 안전 설계(승인 게이트):
 *   1) buildPayslips()  : 행마다 PDF 생성 + Gmail 임시보관함(초안) 작성. **발송 안 함.**
 *   2) (대표가 초안/PDF 검토)
 *   3) sendPayslips()   : READY 상태인 행만 실제 발송 + 상태 기록.
 *
 * 안전장치:
 *   - 이메일 빈/오류 행은 건너뛰고 "!!오류"로 표시 (과거 '잘못된 이메일' 실패 방지).
 *   - TEST_MODE = true 면 모든 메일을 대표 본인에게만 보냄(실전 전 검증용).
 *   - 이미 발송된 행은 다시 안 보냄(멱등).
 *
 * ⚠️ 설치 후 CONFIG의 ID들(특히 TEMPLATE_DOC_ID)을 1회 확인할 것.
 */

const CONFIG = {
  DATA_SHEET_NAME: '급여명세서',                 // Autocrat 데이터 탭 (gid 939827998)
  TEMPLATE_DOC_ID: '16290h-2k5OPyWY-2UrKIHsPQXEVsNzttFMiAuCY4Kyw', // ✅ 검증됨: 급여명세서 템플릿(<<태그>> = 탭 컬럼 일치)
  OUTPUT_FOLDER_ID: '1Xl_clzgT7dUqVpwqwH3TUxo6FyTeW_wi',           // PDF 저장 폴더

  // 열 이름(헤더와 정확히 일치해야 함)
  MONTH_COL: 'month',
  NAME_COL: 'name',
  TITLE_COL: '직급',
  EMAIL_COL: '이메일',
  WB_DOCID: 'Merged Doc ID - 스픽스 급여명세서',
  WB_DOCURL: 'Merged Doc URL - 스픽스 급여명세서',
  WB_LINK: 'Link to merged Doc - 스픽스 급여명세서',
  WB_STATUS: 'Document Merge Status - 스픽스 급여명세서',

  // 메일 양식 (Autocrat Job에서 그대로 가져옴). <<헤더>> 토큰은 데이터 열로 치환.
  SUBJECT_TPL: '<<name>>님, 스픽스 <<month>> 급여명세서입니다.',
  FILENAME_TPL: '<<month>>, <<name>> <<직급>>님  2026년 코리아스픽스 급여명세서',
  REPLY_TO: 'playinthesky@kspeaks.kr',

  // 발송 안전 스위치
  TEST_MODE: true,                               // true면 직원 대신 아래 주소로만 발송
  TEST_REDIRECT_EMAIL: 'playinthesky@kspeaks.kr',
};

/**
 * 이달의 인사말 — 매월 대표가 한 줄만 갈아끼우는 휴먼 영역.
 * 본문은 이 문단을 가운데에 끼워 완성한다.
 */
const MONTHLY_NOTE =
  '이번 달도 수고 많으셨습니다.'; // ← 매월 수정

function buildBody(row) {
  const name = row[CONFIG.NAME_COL];
  const title = row[CONFIG.TITLE_COL] || '';
  const month = row[CONFIG.MONTH_COL];
  return [
    `${name} ${title}님,  ${month} 급여명세서입니다.`,
    '',
    MONTHLY_NOTE,
    '',
    '감사드립니다.',
    '',
    '이병덕 올림',
  ].join('\n');
}

/* ───────────────────────── 메뉴 ───────────────────────── */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🤖 별동수 급여명세서')
    .addItem('1) PDF 생성 + 초안 작성 (발송 안 함)', 'buildPayslips')
    .addItem('2) 검토 후 → 실제 발송', 'sendPayslips')
    .addSeparator()
    .addItem('실패(!!오류) 행만 다시 시도', 'retryFailed')
    .addItem('현재 설정 확인', 'showConfig')
    .addToUi();
}

/* ─────────────────── 1단계: 생성 + 초안 ─────────────────── */
function buildPayslips() {
  const month = promptMonth_();
  if (!month) return;
  const ctx = loadSheet_();
  let made = 0, skipped = 0;

  ctx.rows.forEach((row, i) => {
    if (String(row[CONFIG.MONTH_COL]) !== month) return;
    const status = String(row[CONFIG.WB_STATUS] || '');
    if (status.indexOf('Emails Sent') === 0) return; // 이미 발송됨

    const email = normalizeEmail_(row[CONFIG.EMAIL_COL]);
    if (!email) {
      writeStatus_(ctx, i, '', '', '', `!!오류: 이메일 없음/잘못됨 (${row[CONFIG.NAME_COL]}) — 발송 제외`);
      skipped++;
      return;
    }
    try {
      const { pdfFile, docName } = renderPdf_(ctx.headers, row);
      // 발송용 초안(미리보기) 작성 — 아직 안 보냄
      createDraft_(email, row, pdfFile.getBlob());
      writeStatus_(ctx, i, pdfFile.getId(), pdfFile.getUrl(), docName,
        `READY(미발송): PDF/초안 생성 완료 — ${stamp_()}`);
      made++;
    } catch (e) {
      writeStatus_(ctx, i, '', '', '', `!!오류: 생성 실패 — ${e.message}`);
      skipped++;
    }
  });
  toast_(`생성 완료 — ${made}건 준비됨, ${skipped}건 제외/오류. Gmail 임시보관함에서 검토 후 '2) 발송' 실행.`);
}

/* ─────────────────── 2단계: 승인 후 발송 ─────────────────── */
function sendPayslips() {
  const month = promptMonth_();
  if (!month) return;
  const ui = SpreadsheetApp.getUi();
  const dest = CONFIG.TEST_MODE ? `테스트모드(→ ${CONFIG.TEST_REDIRECT_EMAIL})` : '직원 본인 메일';
  const ok = ui.alert('발송 확인', `${month} 급여명세서를 ${dest}로 발송합니다. 진행할까요?`, ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;

  const ctx = loadSheet_();
  let sent = 0;
  ctx.rows.forEach((row, i) => {
    if (String(row[CONFIG.MONTH_COL]) !== month) return;
    if (String(row[CONFIG.WB_STATUS] || '').indexOf('READY') !== 0) return;

    const realEmail = normalizeEmail_(row[CONFIG.EMAIL_COL]);
    if (!realEmail) return;
    const to = CONFIG.TEST_MODE ? CONFIG.TEST_REDIRECT_EMAIL : realEmail;
    const pdf = DriveApp.getFileById(row[CONFIG.WB_DOCID]).getBlob();

    GmailApp.sendEmail(to, fill_(CONFIG.SUBJECT_TPL, row), buildBody(row), {
      attachments: [pdf], replyTo: CONFIG.REPLY_TO, name: '이병덕',
    });
    writeStatus_(ctx, i, row[CONFIG.WB_DOCID], row[CONFIG.WB_DOCURL], row[CONFIG.WB_LINK],
      `Emails Sent: [To: ${to}; Reply To: ${CONFIG.REPLY_TO}]; 별동수 발송; ${stamp_()}`);
    sent++;
  });
  toast_(`발송 완료 — ${sent}건${CONFIG.TEST_MODE ? ' (테스트모드)' : ''}.`);
}

function retryFailed() {
  const ctx = loadSheet_();
  ctx.rows.forEach((row, i) => {
    if (String(row[CONFIG.WB_STATUS] || '').indexOf('!!오류') === 0) {
      writeStatus_(ctx, i, '', '', '', ''); // 상태 비워서 다음 build 때 재처리
    }
  });
  toast_('실패 행 초기화 완료. 이메일 등 수정 후 "1) PDF 생성"을 다시 실행하세요.');
}

/* ───────────────────────── 내부 유틸 ───────────────────────── */
function renderPdf_(headers, row) {
  const docName = fill_(CONFIG.FILENAME_TPL, row);
  const copy = DriveApp.getFileById(CONFIG.TEMPLATE_DOC_ID)
    .makeCopy(docName, DriveApp.getFolderById(CONFIG.OUTPUT_FOLDER_ID));
  const doc = DocumentApp.openById(copy.getId());
  const body = doc.getBody();
  // <<헤더>> 토큰을 모든 열 값으로 치환 (Autocrat와 동일 규칙)
  headers.forEach((h) => {
    body.replaceText('<<' + escapeRe_(h) + '>>', toText_(row[h]));
  });
  doc.saveAndClose();
  const pdf = DriveApp.getFolderById(CONFIG.OUTPUT_FOLDER_ID)
    .createFile(copy.getBlob().getAs('application/pdf')).setName(docName + '.pdf');
  copy.setTrashed(true); // 중간 Doc은 버리고 PDF만 남김
  return { pdfFile: pdf, docName: docName };
}

function createDraft_(email, row, pdfBlob) {
  const to = CONFIG.TEST_MODE ? CONFIG.TEST_REDIRECT_EMAIL : email;
  GmailApp.createDraft(to, fill_(CONFIG.SUBJECT_TPL, row), buildBody(row), {
    attachments: [pdfBlob], replyTo: CONFIG.REPLY_TO, name: '이병덕',
  });
}

function loadSheet_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(CONFIG.DATA_SHEET_NAME);
  if (!sh) throw new Error(`시트 '${CONFIG.DATA_SHEET_NAME}' 없음`);
  const values = sh.getDataRange().getValues();
  const headers = values[0].map(String);
  const rows = values.slice(1).map((r) => {
    const o = {}; headers.forEach((h, c) => (o[h] = r[c])); return o;
  });
  return { sh, headers, rows, colIndex: indexOf_(headers) };
}

function writeStatus_(ctx, rowIdx, docId, docUrl, link, status) {
  const r = rowIdx + 2; // 헤더 1행 + 0-based
  const ci = ctx.colIndex;
  if (ci[CONFIG.WB_DOCID] != null) ctx.sh.getRange(r, ci[CONFIG.WB_DOCID] + 1).setValue(docId);
  if (ci[CONFIG.WB_DOCURL] != null) ctx.sh.getRange(r, ci[CONFIG.WB_DOCURL] + 1).setValue(docUrl);
  if (ci[CONFIG.WB_LINK] != null) ctx.sh.getRange(r, ci[CONFIG.WB_LINK] + 1).setValue(link);
  if (ci[CONFIG.WB_STATUS] != null) ctx.sh.getRange(r, ci[CONFIG.WB_STATUS] + 1).setValue(status);
}

function promptMonth_() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('대상 월', "발급할 month 값을 입력 (예: 6월)", ui.ButtonSet.OK_CANCEL);
  return res.getSelectedButton() === ui.Button.OK ? res.getResponseText().trim() : null;
}

function showConfig() {
  toast_(`데이터탭=${CONFIG.DATA_SHEET_NAME} · 템플릿=${CONFIG.TEMPLATE_DOC_ID} · TEST_MODE=${CONFIG.TEST_MODE}`);
}

/* 작은 헬퍼들 */
function fill_(tpl, row) { return tpl.replace(/<<([^>]+)>>/g, (_, k) => toText_(row[k.trim()])); }
function toText_(v) { return v === null || v === undefined ? '' : String(v); }
function normalizeEmail_(v) { const s = toText_(v).trim(); return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) ? s : ''; }
function indexOf_(headers) { const m = {}; headers.forEach((h, i) => (m[h] = i)); return m; }
function escapeRe_(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function stamp_() { return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm'); }
function toast_(msg) { SpreadsheetApp.getActive().toast(msg, '별동수', 8); }
