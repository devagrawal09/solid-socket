import { SerovalJSON } from "seroval";
import { $TRACK, $PROXY } from "solid-js";
import { enablePatches } from "immer";
enablePatches();

export type WsMessage<T> = T & { id: string };

export type WsMessageUp =
  // | {
  //     type: "subscribe";
  //     ref: SerializedReactiveThing;
  //   }
  | {
      type: "invoke";
      ref: SerializedRef;
      input: SerovalJSON;
    }
  | {
      type: "value";
      value: SerovalJSON;
    }
  | {
      type: "create";
      name: string;
      input: SerovalJSON;
    }
  | {
      type: "dispose";
    };

export type WsMessageDown =
  // | {
  //     type: "subscribe";
  //     ref: SerializedReactiveThing;
  //   }
  | {
      type: "invoke";
      ref: SerializedRef;
      input: SerovalJSON;
    }
  | {
      type: "value";
      value: SerovalJSON;
    }
  | {
      type: "error";
      error: SerovalJSON;
    };

export type SerializedRef<I = any, O = any> = {
  __type: "ref";
  id: string;
  scope: string;
};
export class SerializedRefClass {
  constructor(public handler: Function) {}
}

export type SerializedMemo<O = any> = {
  __type: "memo";
  id: string;
  scope: string;
  initial?: O;
};

export class SerializedMemoClass {
  constructor(public signal: Function) {}
}

export type SerializedProjection<O = any> = {
  __type: "projection";
  id: string;
  scope: string;
  initial?: O;
};

export class SerializedProjectionClass {
  constructor(public init: any, public mutation: Function) {}
}

export type SerializedReactiveThing<T = any> =
  | SerializedMemo<T>
  | SerializedProjection<T>;

export type SerializedThing = SerializedRef | SerializedReactiveThing;

export function createSeriazliedRef(
  opts: Omit<SerializedRef, "__type">
): SerializedRef {
  return { ...opts, __type: "ref" };
}

export function createSeriazliedMemo(
  opts: Omit<SerializedMemo, "__type">
): SerializedMemo {
  return { ...opts, __type: "memo" };
}

export function createSeriazliedProjection(
  opts: Omit<SerializedProjection, "__type">
): SerializedProjection {
  return { ...opts, __type: "projection" };
}

export function createSocketRef<F extends Function>(source: F): F {
  // @ts-expect-error
  return new SerializedRefClass(source);
}

export function createSocketMemo<T>(source: () => T): () => T | undefined {
  // @ts-expect-error
  return new SerializedMemoClass(source);
}

export function createSocketProjection<T extends object>(
  mutation: (draft: T) => void,
  init?: T
): T | undefined {
  // @ts-expect-error
  return new SerializedProjectionClass(init, mutation);
}
