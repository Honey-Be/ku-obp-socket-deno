import { range } from "https://deno.land/x/it_range@v1.0.3/range.mjs";

export function shuffleArrayWithArgs<T, A>(array: T[], rng: (args: A) => number, args: A): T[] {
    for (const i of Array.from(range(1,array.length)).reverse()) {
        const j = Math.floor(rng(args) * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

export function shuffleArray<T>(array: T[], rng: () => number = Math.random): T[] {
    for (const i of Array.from(range(1,array.length)).reverse()) {
        const j = Math.floor(rng() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}