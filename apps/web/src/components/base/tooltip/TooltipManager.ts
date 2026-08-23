type CloseCallback = () => void;

class TooltipManager {
  private closeCallbacks: Set<CloseCallback> = new Set();

  register(close: CloseCallback) {
    this.closeCallbacks.add(close);
  }

  clear(close: CloseCallback) {
    this.closeCallbacks.delete(close);
  }

  closeAll() {
    this.closeCallbacks.forEach((close) => close());
    this.closeCallbacks.clear();
  }
}

export const tooltipManager = new TooltipManager();

