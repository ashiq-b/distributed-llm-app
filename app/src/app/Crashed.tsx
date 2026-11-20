// If a screen throws, say so and offer a reload, instead of leaving a blank window.
import { Component, type ReactNode } from "react";

export default class Crashed extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" className="mx-auto max-w-lg space-y-4 px-5 pt-[calc(env(safe-area-inset-top)+3rem)]">
        <h1 className="font-serif text-3xl font-medium">The app hit an error</h1>
        <p className="text-pretty text-muted-foreground">Reload to start again. If it keeps happening, send this message with a screenshot:</p>
        <pre className="whitespace-pre-wrap break-words rounded-xl border bg-surface p-3 text-sm">{error.message}</pre>
        <button className="h-11 rounded-full bg-primary px-5 font-semibold text-primary-foreground" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
