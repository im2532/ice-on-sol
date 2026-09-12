import { Button } from "@/components/agentic/Button";
import { Icon } from "@/components/agentic/Icon/Icon";
export default function NotFound() {
  return (
    <div className="agentic-page mx-auto flex max-w-xl flex-col items-center gap-5 py-24 text-center">
      <Icon name="search" size={40} />
      <span className="eyebrow">404 · Page not found</span>
      <h1 className="display text-4xl">Nothing to see here.</h1>
      <p className="text-sm text-body">
        This page or market could not be found. Let’s get you back to the
        exchange.
      </p>
      <Button href="/">Back to markets</Button>
    </div>
  );
}
