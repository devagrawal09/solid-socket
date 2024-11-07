import { from as rxFrom, mergeMap, Observable, tap } from "rxjs";
import {
  createSeriazliedMemo,
  SerializedMemo,
  SerializedRef,
  SerializedThing,
  WsMessage,
  WsMessageDown,
  WsMessageUp,
} from "./shared";
import {
  createEffect,
  createMemo,
  from,
  getOwner,
  onCleanup,
  runWithOwner,
  untrack,
} from "solid-js";
import { createAsync } from "@solidjs/router";
import { createLazyMemo } from "@solid-primitives/memo";

const globalWsPromise = new Promise<SimpleWs>((resolve) => {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const wsUrl = `${protocol}://${window.location.hostname}:${window.location.port}/_ws`;
  const ws = new WebSocket(wsUrl);
  ws.onopen = () => resolve(ws);
});

export type Listener = (ev: { data: any }) => any;
export type SimpleWs = {
  removeEventListener(type: "message", listener: Listener): void;
  addEventListener(type: "message", listener: Listener): void;
  send(data: string): void;
};

function wsRpc<T>(message: WsMessageUp, wsPromise: Promise<SimpleWs>) {
  const id = crypto.randomUUID() as string;

  return new Promise<{ value: T; dispose: () => void }>(async (res, rej) => {
    const ws = await wsPromise;

    function dispose() {
      ws.send(
        JSON.stringify({ type: "dispose", id } satisfies WsMessage<WsMessageUp>)
      );
    }

    function handler(event: { data: string }) {
      // console.log(`handler ${id}`, message, { data: event.data });
      const data = JSON.parse(event.data) as WsMessage<WsMessageDown<T>>;
      if (data.id === id && data.type === "value") {
        res({ value: data.value, dispose });
        ws.removeEventListener("message", handler);
      }
    }

    ws.addEventListener("message", handler);
    ws.send(
      JSON.stringify({ ...message, id } satisfies WsMessage<WsMessageUp>)
    );
  });
}

function wsSub<T>(message: WsMessageUp, wsPromise: Promise<SimpleWs>) {
  const id = crypto.randomUUID();

  return rxFrom(Promise.resolve(wsPromise)).pipe(
    mergeMap((ws) => {
      return new Observable<T>((obs) => {
        // console.log(`attaching sub handler`);
        function handler(event: { data: string }) {
          const data = JSON.parse(event.data) as WsMessage<WsMessageDown<T>>;
          // console.log(`data`, data, id);
          if (data.id === id && data.type === "value") obs.next(data.value);
        }

        ws.addEventListener("message", handler);
        ws.send(
          JSON.stringify({ ...message, id } satisfies WsMessage<WsMessageUp>)
        );

        return () => {
          // console.log(`detaching sub handler`);
          ws.removeEventListener("message", handler);
        };
      });
    })
  );
}

export function createRef<I, O>(
  ref: SerializedRef,
  wsPromise: Promise<SimpleWs>
) {
  return (input: I) =>
    wsRpc<O>(
      {
        type: "invoke",
        ref,
        input,
      },
      wsPromise
    ).then(({ value }) => value);
}

export function createSocketMemoConsumer<O>(
  ref: SerializedMemo,
  wsPromise: Promise<SimpleWs>
) {
  // console.log({ ref });
  const memo = createLazyMemo(
    () =>
      from(
        wsSub<O>(
          {
            type: "subscribe",
            ref,
          },
          wsPromise
        )
      ),
    () => ref.initial
  );

  return () => {
    const memoValue = memo()();
    // console.log({ memoValue });
    return memoValue;
  };
}

type SerializedValue = SerializedThing | Record<string, SerializedThing>;

const deserializeValue = (value: SerializedValue) => {
  if (value.__type === "ref") {
    return createRef(value, globalWsPromise);
  } else if (value.__type === "memo") {
    return createSocketMemoConsumer(value, globalWsPromise);
  } else {
    return Object.entries(value).reduce((res, [name, value]) => {
      return {
        ...res,
        [name]:
          value.__type === "ref"
            ? createRef(value, globalWsPromise)
            : value.__type === "memo"
              ? createSocketMemoConsumer(value, globalWsPromise)
              : value,
      };
    }, {} as any);
  }
};

export function createEndpoint(
  name: string,
  input?: any,
  wsPromise = globalWsPromise
) {
  const inputScope = crypto.randomUUID();
  const serializedInput =
    input?.type === "memo"
      ? createSeriazliedMemo({
        name: `input`,
        scope: inputScope,
        initial: untrack(input),
      })
      : input;
  // console.log({ serializedInput });

  const scopePromise = wsRpc<SerializedValue>(
    { type: "create", name, input: serializedInput },
    wsPromise
  );

  const o = getOwner();
  if (input?.type === "memo") {
    // console.log(`listening for subscriptions on input memo`);
    wsPromise.then((ws) => {
      runWithOwner(o, () => {
        // console.log(`listening for subscriptions on input memo`);

        function handler(event: { data: string }) {
          const data = JSON.parse(event.data) as WsMessage<WsMessageDown<any>>;

          if (data.type === "subscribe" && data.ref.scope === inputScope) {
            runWithOwner(o, () => {
              // console.log(`server subscribed to input`);

              createEffect(() => {
                const value = input();
                // console.log(`sending input update to server`, value);
                ws.send(
                  JSON.stringify({
                    type: "value",
                    id: data.id,
                    value,
                  } satisfies WsMessage<WsMessageUp>)
                );
              });
            });
          }
        }
        ws.addEventListener("message", handler);
        onCleanup(() => ws.removeEventListener("message", handler));
      });
    });
  }

  onCleanup(() => {
    // console.log(`cleanup endpoint`);
    scopePromise.then(({ dispose }) => dispose());
  });

  const scope = createAsync(() => scopePromise);
  const deserializedScope = createMemo(
    () => scope() && deserializeValue(scope()!.value)
  );

  return new Proxy((() => { }) as any, {
    get(_, path) {
      const res = deserializedScope()?.[path];
      return res || (() => { });
    },
    apply(_, __, args) {
      const res = deserializedScope()?.(...args);
      return res;
    },
  });
}
