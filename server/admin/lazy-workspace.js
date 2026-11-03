// Keep a workspace's DOM/listeners and in-progress editing state after first use.
export function createLazyWorkspace(load, options) {
  let instance, pending;
  return {
    get() {
      if (instance) return Promise.resolve(instance);
      return pending ??= load().then(initialize => instance = initialize(options)).finally(() => { pending = null; });
    },
    reset() { instance?.reset(); },
    leave() { return instance?.leave?.() ?? true; },
  };
}
