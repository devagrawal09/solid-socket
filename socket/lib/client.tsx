import { createLazyMemo } from "@solid-primitives/memo";
import { createWS } from "@solid-primitives/websocket";
import { createAsync } from "@solidjs/router";
import { applyPatches, Patch } from "immer";
import { fromJSON, SerovalJSON, toJSON } from "seroval";
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { createStore, produce } from "solid-js/store";
import {
  deserializeReactivePayload,
  serializeReactivePayload,
} from "./serializer";
import {
  SerializedMemo,
  SerializedProjection,
  SerializedRef,
  WsMessage,
  WsMessageDown,
  WsMessageUp,
} from "./shared";

const protocol = window.location.protocol === "https:" ? "wss" : "ws";
const wsUrl = `${protocol}://${window.location.hostname}:${window.location.port}/_ws`;
const getWs = createLazyMemo(() => createWS(wsUrl));

export type Listener = (ev: { data: any }) => any;
export type SimpleWs = {
  removeEventListener(type: "message", listener: Listener): void;
  addEventListener(type: "message", listener: Listener): void;
  send(data: string): void;
};

function wsRpc(message: WsMessageUp) {
  const ws = getWs();
  const id = crypto.randomUUID() as string;

  return new Promise<{ value: SerovalJSON; dispose: () => void }>(
    async (res, rej) => {
      function dispose() {
        ws.removeEventListener("message", handler);
        ws.send(
          JSON.stringify({
            type: "dispose",
            id,
          } satisfies WsMessage<WsMessageUp>)
        );
      }

      function handler(event: { data: string }) {
        // console.log(`handler ${id}`, message, { data: event.data });
        const data = JSON.parse(event.data) as WsMessage<WsMessageDown>;
        if (data.id === id && data.type === "value") {
          res({ value: data.value, dispose });
        }
        if (data.id === id && data.type === "error") {
          rej(data.error);
        }
      }

      ws.addEventListener("message", handler);
      ws.send(
        JSON.stringify({ ...message, id } satisfies WsMessage<WsMessageUp>)
      );
    }
  );
}

function createSocketRefConsumer<I extends any[], O>(ref: SerializedRef) {
  return async (...payload: I) => {
    const input = toJSON(payload);
    const { value, dispose } = await wsRpc({ type: "invoke", ref, input });
    dispose();
    return fromJSON<O>(value);
  };
}

function createSocketMemoConsumer<O>(ref: SerializedMemo<O>) {
  const [signal, setSignal] = createSignal(ref.initial);

  const ws = getWs();
  function handler(event: { data: string }) {
    const data = JSON.parse(event.data) as WsMessage<WsMessageDown>;
    if (data.type === "value" && data.id === ref.id) {
      setSignal(() => fromJSON<O>(data.value));
    }
  }
  ws.addEventListener("message", handler);

  onCleanup(() => {
    ws.removeEventListener("message", handler);
  });

  return signal;
}

function createSocketProjectionConsumer<O extends object>(
  ref: SerializedProjection<O>
) {
  const [store, setStore] = createStore(ref.initial!);

  const ws = getWs();
  function handler(event: { data: string }) {
    const data = JSON.parse(event.data) as WsMessage<WsMessageDown>;
    if (data.type === "value" && data.id === ref.id) {
      setStore(
        produce((draft) => {
          applyPatches(draft, fromJSON<Patch[]>(data.value));
        })
      );
    }
  }
  ws.addEventListener("message", handler);

  onCleanup(() => {
    ws.removeEventListener("message", handler);
  });

  return store;
}

export function createEndpoint(name: string, rawInput?: any) {
  const inputScope = crypto.randomUUID();
  const {
    value: input,
    refs,
    signals,
  } = serializeReactivePayload(inputScope, rawInput);
  // console.log({ serializedInput });

  const scopePromise = wsRpc({ type: "create", name, input });

  const ws = getWs();
  signals.forEach((signal, id) => {
    createEffect(() => {
      ws.send(JSON.stringify({ type: "value", id, value: toJSON(signal()) }));
    });
  });

  async function refHandler(event: { data: string }) {
    const data = JSON.parse(event.data) as WsMessage<WsMessageDown>;
    if (data.type === "invoke" && data.ref.scope === inputScope) {
      const fn = refs.get(data.ref.id);
      if (fn) {
        const fnInput = fromJSON(data.input);
        const arified = Array.isArray(fnInput) ? fnInput : [fnInput];
        const res = await fn(...arified);
        const value = toJSON(res);
        ws.send(JSON.stringify({ type: "value", id: data.id, value }));
      }
    }
  }
  ws.addEventListener("message", refHandler);

  onCleanup(() => {
    // console.log(`cleanup endpoint`);
    ws.removeEventListener("message", refHandler);
    scopePromise.then(({ dispose }) => dispose());
  });

  const scope = createAsync(() => scopePromise);
  const deserializedScope = createMemo(
    () =>
      scope() &&
      deserializeReactivePayload(scope()!.value, {
        createSocketMemoConsumer,
        createSocketRefConsumer,
        createSocketProjectionConsumer,
      })
  );

  return new Proxy((() => {}) as any, {
    get(_, path) {
      const res = deserializedScope()?.[path];
      return res || (() => {});
    },
    apply(_, __, args) {
      const res = deserializedScope()?.(...args);
      return res;
    },
  });
}
