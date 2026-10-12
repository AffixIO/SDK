export function instrument({ tracer, meter, onInstrumentationError = () => {} } = {}) {
  const safely = operation => {
    try { return operation(); } catch (error) { try { onInstrumentationError(error); } catch {} }
  };
  const counter = safely(() => meter?.createCounter("affix.operations"));
  const duration = safely(() => meter?.createHistogram("affix.operation.duration", { unit: "ms" }));
  return async (operation, work) => {
    if (!["decision", "proof", "verify", "action", "source", "review"].includes(operation)) throw new TypeError("Unsupported telemetry operation");
    const span = safely(() => tracer?.startSpan(`affix.${operation}`));
    const start = performance.now();
    let outcome = "ok";
    try { return await work(); }
    catch (error) { outcome = "error"; safely(() => span?.setStatus({ code: 2 })); throw error; }
    finally {
      safely(() => counter?.add(1, { operation, outcome }));
      safely(() => duration?.record(performance.now() - start, { operation, outcome }));
      safely(() => span?.setAttribute("affix.outcome", outcome));
      safely(() => span?.end());
    }
  };
}
