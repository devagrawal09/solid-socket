import { createAsync, type RouteSectionProps } from "@solidjs/router";
import { ErrorBoundary, Show } from "solid-js";
import { Login, Logout } from "~/components/auth";
import { Invites } from "~/components/invites";
import { PresenceHost } from "~/components/presence";
import { TodoApp, TodosFilter } from "~/components/todos";
import { getUserId } from "~/lib/auth";
import { useCounter } from "~/lib/counter";

export default function TodoAppPage(props: RouteSectionProps) {
  // const userId = createAsync(() => getUserId());
  const counter = useCounter();

  return (
    <ErrorBoundary fallback={<div>Something went wrong</div>}>
      <button onClick={() => counter.increment()}>
        Count {counter.count()}
      </button>
      {/* <Show
        when={userId()}
        fallback={
          <>
            <h1>Welcome to Solid Socket</h1>
            <h2 style={{ "font-weight": "normal" }}>
              The easiest and most powerful way to build realtime applications
              on top of SolidStart.
            </h2>
            <a
              href="https://github.com/devagrawal09/solid-socket/"
              target="_blank"
            >
              Read the docs
            </a>

            <h2>Demo</h2>
            <p>
              A realtime and multiplayer todo application. Login with any
              username to access the todo list, and invite your friends to
              collaborate with you!
            </p>
            <p>
              Or if you don't have friends, you can collaborate with yourself!
              Just open multiple windows using different browsers or devices and
              login using a different username.
            </p>
            <Login />
          </>
        }
      >
        <Logout />
        <PresenceHost>
          <TodoApp filter={props.location.query.show as TodosFilter} />
        </PresenceHost>
        <Invites />
      </Show> */}
    </ErrorBoundary>
  );
}
