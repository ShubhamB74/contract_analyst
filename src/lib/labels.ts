/** Display names that stay unique when two uploads share a filename (e.g. two "contract.pdf"). */
export function uniqueLabels(items: { id: string; name: string }[]): Record<string, string> {
  const total: Record<string, number> = {};
  const seen: Record<string, number> = {};
  items.forEach((i) => (total[i.name] = (total[i.name] ?? 0) + 1));
  const out: Record<string, string> = {};
  items.forEach((i) => {
    if (total[i.name] > 1) {
      seen[i.name] = (seen[i.name] ?? 0) + 1;
      out[i.id] = `${i.name} (${seen[i.name]})`;
    } else out[i.id] = i.name;
  });
  return out;
}
