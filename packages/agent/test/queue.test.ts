import { describe, expect, it } from "vitest";
import { MessageQueue } from "../src/queue.js";

describe("MessageQueue", () => {
  it("yields values pushed before iteration starts", async () => {
    const queue = new MessageQueue<string>();
    queue.push("first");

    const iterator = queue[Symbol.asyncIterator]();
    expect(await iterator.next()).toEqual({ value: "first", done: false });
    queue.close();
  });

  it("resolves a consumer waiting for the next value", async () => {
    const queue = new MessageQueue<string>();
    const iterator = queue[Symbol.asyncIterator]();
    const pending = iterator.next();
    queue.push("delivered");

    await expect(pending).resolves.toEqual({ value: "delivered", done: false });
    queue.close();
  });

  it("ends an awaiting consumer when closed", async () => {
    const queue = new MessageQueue<string>();
    const iterator = queue[Symbol.asyncIterator]();
    const pending = iterator.next();
    queue.close();

    await expect(pending).resolves.toEqual({ value: undefined, done: true });
  });

  it("drops values pushed after close", async () => {
    const queue = new MessageQueue<string>();
    queue.close();
    queue.push("ignored");

    const iterator = queue[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
  });

  it("preserves push order", async () => {
    const queue = new MessageQueue<number>();
    queue.push(1);
    queue.push(2);
    queue.push(3);
    const iterator = queue[Symbol.asyncIterator]();

    expect(await iterator.next()).toMatchObject({ value: 1, done: false });
    expect(await iterator.next()).toMatchObject({ value: 2, done: false });
    expect(await iterator.next()).toMatchObject({ value: 3, done: false });
    queue.close();
  });
});
