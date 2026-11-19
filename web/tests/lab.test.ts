import { describe, expect, it } from "vitest";
import { stageOf, verdict } from "../src/data/lab";
import type { BotStrategy } from "../src/data/model";

describe("the Lab's verdicts", () => {
  it("judges by the held-back years: burned first, then too few, then the average trade", () => {
    expect(verdict(null)).toBe("none");
    expect(verdict({ burned: true, trades: 200, expectancy: 50 })).toBe("burned");
    expect(verdict({ trades: 9, expectancy: 50 })).toBe("few");
    expect(verdict({ trades: 40, expectancy: null })).toBe("few");
    expect(verdict({ trades: 40, expectancy: 12.5 })).toBe("held");
    expect(verdict({ trades: 40, expectancy: 0 })).toBe("failed");
    expect(verdict({ trades: 40, expectancy: -3 })).toBe("failed");
  });
  it("a backtest is paper trading once a strategy made from it is switched on", () => {
    const bot = (enabled: boolean, id: string) => ({ id: "b", label: "x", enabled, config: {} as BotStrategy["config"], source: { kind: "option", id } } as unknown as BotStrategy);
    expect(stageOf("ic_9d", [])).toBe("backtested");
    expect(stageOf("ic_9d", [bot(false, "ic_9d")])).toBe("backtested");
    expect(stageOf("ic_9d", [bot(true, "other")])).toBe("backtested");
    expect(stageOf("ic_9d", [bot(true, "ic_9d")])).toBe("paper");
  });
});
