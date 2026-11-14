export function log(payoutId: number | null, msg: string) {
  const tag = payoutId === null ? "relayer" : `payout#${payoutId}`;
  console.log(`${new Date().toISOString()} [${tag}] ${msg}`);
}
