/** Wait until the next decoded video frame is available (RVFC, else double rAF). */
export function waitForVideoFrame(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    const v = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
    };
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    const timer = window.setTimeout(finish, 250);
    if (typeof v.requestVideoFrameCallback === 'function') {
      v.requestVideoFrameCallback(() => {
        window.clearTimeout(timer);
        finish();
      });
      return;
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.clearTimeout(timer);
        finish();
      });
    });
  });
}
