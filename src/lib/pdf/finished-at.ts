/**
 * When something was finished, for the record. With signal the two clocks
 * agree and one time prints. Finished with no signal and sent later, the
 * phone's time is the finish and the arrival is noted — "finished 06:48,
 * received 09:02" is the truth; "finished 09:02" is not.
 */
export function finishedAtAwst(completedAt: string, onDeviceAt: string | null | undefined): string {
  const fmt = (iso: string) => {
    const d = new Date(Date.parse(iso) + 480 * 60000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  };
  if (!onDeviceAt || Math.abs(Date.parse(onDeviceAt) - Date.parse(completedAt)) < 2 * 60 * 1000) {
    return `${fmt(completedAt)} AWST`;
  }
  return `${fmt(onDeviceAt)} AWST on the phone; received ${fmt(completedAt)} AWST`;
}
