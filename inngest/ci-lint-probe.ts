// CI probe (CC-00): deliberately violates @typescript-eslint/no-explicit-any so the lint job
// must fail. Removed by the next commit; both commits are kept as evidence.
export const ciLintProbe: any = 1;
