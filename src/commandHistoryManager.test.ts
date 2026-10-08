import { assertEquals, assertThrows } from "@std/assert";
import { Command } from "./commandModel.ts";
import { CommandBus } from "./commandBus.ts";
import { CommandHistoryManager } from "./commandHistoryManager.ts";

class Add extends Command<number, number> {}
class Sub extends Command<number, number> {}

function setup() {
  const state = { value: 0 };
  const history = new CommandHistoryManager();
  history.register(Add, (c) => (state.value += c.data));
  history.register(Sub, (c) => (state.value -= c.data));
  return { state, history };
}

Deno.test("CommandHistoryManager - failed undo/redo keeps the entry", async (t) => {
  await t.step("undo keeps the entry when the inverse throws", () => {
    const { state, history } = setup();
    history.execute(new Add(5), new Sub(5));

    let fail = true;
    history.bus.register(Sub, (c) => {
      if (fail) throw new Error("boom");
      return (state.value -= c.data);
    });

    assertThrows(() => history.undo(), Error, "boom");
    assertEquals(history.undoCount, 1);
    assertEquals(history.redoCount, 0);

    fail = false;
    history.undo();
    assertEquals(state.value, 0);
    assertEquals(history.undoCount, 0);
    assertEquals(history.redoCount, 1);
  });

  await t.step("redo keeps the entry when the forward command throws", () => {
    const { state, history } = setup();
    history.execute(new Add(5), new Sub(5));
    history.undo();

    let fail = true;
    history.bus.register(Add, (c) => {
      if (fail) throw new Error("boom");
      return (state.value += c.data);
    });

    assertThrows(() => history.redo(), Error, "boom");
    assertEquals(history.redoCount, 1);
    assertEquals(history.undoCount, 0);

    fail = false;
    history.redo();
    assertEquals(state.value, 5);
    assertEquals(history.undoCount, 1);
  });
});

Deno.test("CommandHistoryManager - execute() options vs context", async (t) => {
  await t.step("a context that happens to contain `source` stays a context", () => {
    const history = new CommandHistoryManager();
    const seen: any[] = [];
    history.register(Add, (c, ctx) => {
      seen.push(ctx);
      return c.data;
    });

    const userCtx = { source: "ui", userId: 1 };
    history.execute(new Add(1), new Sub(1), userCtx);
    assertEquals(seen[0], userCtx);
  });

  await t.step("a pure options object is still treated as options", () => {
    const history = new CommandHistoryManager();
    const other = new CommandBus();
    other.register(Add, (c) => c.data * 10);
    history.registerBus(other, "other");

    const result = history.execute(new Add(2), new Sub(2), {
      bus: other,
      source: "ui",
      description: "custom",
    });
    assertEquals(result, 20);
    assertEquals(history.getHistory().undo[0].description, "custom");
    assertEquals(history.getHistory().undo[0].source, "ui");
  });
});

Deno.test("CommandHistoryManager - batches", async (t) => {
  await t.step("batch on an unregistered bus can be undone and redone", () => {
    const { state, history } = setup();
    const other = new CommandBus();
    other.register(Add, (c) => (state.value += c.data));
    other.register(Sub, (c) => (state.value -= c.data));

    history.beginBatch("two");
    history.execute(new Add(2), new Sub(2), { bus: other });
    history.execute(new Add(3), new Sub(3), { bus: other });
    history.endBatch();
    assertEquals(state.value, 5);

    history.undo();
    assertEquals(state.value, 0);
    history.redo();
    assertEquals(state.value, 5);
  });

  await t.step("batch items keep their own context", () => {
    const history = new CommandHistoryManager();
    const seen: string[] = [];
    history.register(Add, (_c, ctx: any) => {
      seen.push(`add:${ctx.who}`);
      return 0;
    });
    history.register(Sub, (_c, ctx: any) => {
      seen.push(`sub:${ctx.who}`);
      return 0;
    });

    history.beginBatch();
    history.execute(new Add(1), new Sub(1), { who: "a" });
    history.execute(new Add(1), new Sub(1), { who: "b" });
    history.endBatch();
    seen.length = 0;

    history.undo();
    assertEquals(seen, ["sub:b", "sub:a"]);
  });
});
