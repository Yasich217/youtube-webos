/**
 * Wait for a child element to be added that holds true for a predicate
 * @template T
 * @param {Element} parent
 * @param {(node: Node) => node is T} predicate
 * @param {AbortSignal=} abortSignal
 * @return {Promise<T>}
 */
export async function waitForChildAdd(parent, predicate, abortSignal) {
  return new Promise((resolve, reject) => {
    const obs = new MutationObserver((mutations) => {
      for (const mut of mutations) {
        switch (mut.type) {
          case 'attributes': {
            if (predicate(mut.target)) {
              obs.disconnect();
              resolve(mut.target);
              return;
            }
            break;
          }
          case 'childList': {
            for (const node of mut.addedNodes) {
              if (predicate(node)) {
                obs.disconnect();
                resolve(node);
                return;
              }
            }
            break;
          }
        }
      }
    });

    if (abortSignal) {
      abortSignal.addEventListener('abort', () => {
        obs.disconnect();
        reject(new Error('aborted'));
      });
    }

    obs.observe(parent, { subtree: true, attributes: true, childList: true });
  });
}
