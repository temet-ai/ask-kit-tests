interface Officer { name: string; rank: { title: string; grade: number } }
export const vimes: Officer = { name: "Sam Vimes", rank: { title: "Commander", grade: "high" } };
export function promote(o: Officer): Officer { return { ...o, rank: o.rank.title }; }
