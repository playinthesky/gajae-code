# 일반업무 워크플로우 (Workflows)

대표가 지시하는 정기 업무를 **워크플로우로 정리 → Figma 시각화 → GitHub 저장**하는 공간.

## 인덱스

| 워크플로우 | 주기 | 설명 | Figma |
|------------|------|------|-------|
| [월간 단기직원 급여 → 세무사](./monthly-payroll-tax.md) | 매월 26일경 | 단기직원 급여 계산·차장 확인·세무사 급여명세서 요청 (급여명세서 발급의 **선행**) | [FigJam](https://www.figma.com/board/TB9eM9ydMNCPJL6dQTTrLA) |
| [급여명세서 발급 자동화](./payslip-automation/README.md) | 매월 말 | 2026_sal "급여명세서" 탭 → PDF 생성 → 승인 → 직원 발송 (Apps Script, **후행**) | — |

## 공용 데이터
- [`org-chart.yaml`](./org-chart.yaml) — 조직도(자동화용). "담당 차장" 등 라우팅에 사용.

## 원칙
- **민감정보 금지:** 주민등록번호·계좌번호 등은 이 레포에 넣지 않는다. (Google Drive 원본에만)
- 각 워크플로우는 사람용(Figma) + 기계용(이 문서/YAML) 두 벌로 관리.
