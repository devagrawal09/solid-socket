import { parse as parseCookie } from "cookie-es";
import type { Peer } from "crossws";
import { applyPatches, Patch } from "immer";
import { fromJSON, SerovalJSON, toJSON } from "seroval";
import {
  createContext,
  createEffect,
  createRoot,
  createSignal,
  onCleanup,
  useContext,
} from "solid-js";
import { createStore, produce } from "solid-js/store";
import { getManifest } from "vinxi/manifest";
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

const peerCtx = createContext<Peer>();
export const usePeer = () => {
  const peer = useContext(peerCtx);
  if (!peer) throw new Error(`No peer context found`);
  return peer;
};

export function useCookies<T extends object = Record<string, string>>() {
  const peer = usePeer();

  let parsedCookies: T;
  const getParsedCookies = () => {
    if (parsedCookies) return parsedCookies;
    // @ts-expect-error
    return (parsedCookies = parseCookie(peer.headers.cookie || ``) as T);
  };

  return new Proxy({} as T, {
    get(_, path: string) {
      const cookies = getParsedCookies();
      // @ts-expect-error
      return cookies[path];
    },
  });
}

export type Callable<T> = (arg: unknown) => T | Promise<T>;

export type Endpoint<I> = (
  input: I
) => Callable<any> | Record<string, Callable<any>>;
export type Endpoints = Record<string, Endpoint<any>>;

export class LiveSolidServer {
  private closures = new Map<
    string,
    { refs?: Map<string, Function>; disposal: () => void }
  >();
  observers = new Map<string, (value: any) => void>();

  constructor(public peer: Peer) {}

  send(message: WsMessage<WsMessageDown>) {
    this.peer.send(JSON.stringify(message));
  }

  handleMessage(message: WsMessage<WsMessageUp>) {
    if (message.type === "create") {
      this.create(message.id, message.name, message.input);
    }

    if (message.type === "dispose") {
      this.dispose(message.id);
    }

    if (message.type === "invoke") {
      this.invoke(message.id, message.ref, message.input);
    }

    if (message.type === "value") {
      this.observers.get(message.id)?.(message.value);
    }
  }

  async create(id: string, name: string, input?: SerovalJSON) {
    try {
      const [filepath, functionName] = name.split("#");
      const module = await getManifest(import.meta.env.ROUTER_NAME).chunks[
        filepath
      ].import();
      const endpoint = module[functionName];

      if (!endpoint) throw new Error(`Endpoint ${name} not found`);

      const { refs, disposal } = createRoot((disposal) => {
        const deserializedInput =
          input &&
          deserializeReactivePayload(input, {
            createSocketRefConsumer: (ref) =>
              createSocketRefConsumer(ref, this),
            createSocketMemoConsumer: (ref) =>
              createSocketMemoConsumer(ref, this),
            createSocketProjectionConsumer: (ref) =>
              createSocketProjectionConsumer(ref, this),
          });

        let payload: any;
        peerCtx.Provider({
          value: this.peer,
          // @ts-expect-error
          children: () => (payload = endpoint(deserializedInput)),
        });

        const { refs, signals, value } = serializeReactivePayload(id, payload);
        this.send({ value, id, type: "value" });

        const scope = id;
        signals.forEach((signal, id) => {
          createEffect(() => {
            try {
              this.send({ value: toJSON(signal()), id, type: "value" });
            } catch (error) {
              this.send({ error: toJSON(error), id: scope, type: "error" });
            }
          });
        });

        return { refs, disposal };
      });
      this.closures.set(id, { refs, disposal });
      console.log({ id, refs, cl: this.closures });
    } catch (error) {
      this.send({ error: toJSON(error), id, type: "error" });
    }
  }

  async invoke<I, O>(id: string, ref: SerializedRef<I, O>, input: SerovalJSON) {
    try {
      const c = this.closures.get(ref.scope);
      console.log({ ref, c, cl: this.closures });
      const refFn = c!.refs!.get(ref.id)!;
      const fnInput = fromJSON(input);
      const arified = Array.isArray(fnInput) ? fnInput : [fnInput];
      const response = await refFn(...arified);
      const value = toJSON(response);
      this.send({ id, value, type: "value" });
    } catch (error) {
      this.send({ id, error: toJSON(error), type: "error" });
    }
  }

  dispose(id: string) {
    const closure = this.closures.get(id);
    if (closure) {
      closure.disposal();
      this.closures.delete(id);
    }
  }

  cleanup() {
    for (const [key, closure] of this.closures.entries()) {
      closure.disposal();
      this.closures.delete(key);
    }
  }
}

function createSocketRefConsumer<I extends any[], O>(
  ref: SerializedRef,
  server: LiveSolidServer
) {
  const inputSubId = crypto.randomUUID();

  return (...payload: I) => {
    const input = toJSON(payload);

    server.send({ type: "invoke", id: inputSubId, ref, input });

    return new Promise<O>((res) => {
      server.observers.set(inputSubId, (value) => {
        res(fromJSON(value));
        server.observers.delete(inputSubId);
      });
    });
  };
}

function createSocketMemoConsumer<O>(
  ref: SerializedMemo<O>,
  server: LiveSolidServer
) {
  const [signal, setSignal] = createSignal(ref.initial);
  server.observers.set(ref.id, (value) => setSignal(() => fromJSON<O>(value)));
  onCleanup(() => server.observers.delete(ref.id));
  return signal;
}

function createSocketProjectionConsumer<O>(
  ref: SerializedProjection<O>,
  server: LiveSolidServer
) {
  const [store, setStore] = createStore(ref.initial!);
  server.observers.set(ref.id, (patches) => {
    setStore(
      produce((draft) => {
        applyPatches(draft, fromJSON<Patch[]>(patches));
      })
    );
  });
  onCleanup(() => server.observers.delete(ref.id));
  return store;
}
