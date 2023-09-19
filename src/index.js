
export function *count(n) {
  for (let i = 0; i < n; i++) {
    yield i;
  }
}

export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export const asyncForEach = async (values, callback) => {
  for await (const value of values) {
    await callback(value);
  }
};

export const parallel = (limit, callback) => {
  function *workers() {
    for (const worker of count(limit)) {
      yield callback(worker);
    }
  }
  return Promise.all(workers());
};

export const parallelForEach = async (limit, values, callback) => {
  return parallel(limit, () => asyncForEach(values, callback));
};

export const asyncReduce = async (zero, values, callback) => {
  for await (const value of values) {
    zero = await callback(zero, value);
  }
  return zero;
};

export const parallelReduce = async (limit, zero, values, callback) => {
  values = await parallel(limit, () => asyncReduce(zero, values, callback));
  return asyncReduce(zero, values, callback);
};

export const makePromiseKit = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

export const makeQueue = () => {
  const ends = makePromiseKit();
  return {
    put(value) {
      const next = makePromiseKit();
      const promise = next.promise;
      ends.resolve({ value, promise });
      ends.resolve = next.resolve;
    },
    get() {
      const promise = ends.promise.then(next => next.value);
      ends.promise = ends.promise.then(next => next.promise);
      return promise;
    },
  };
};

export const makeMutex = () => {
  const queue = makeQueue();
  const lock = () => {
    return queue.get()
  }
  const unlock = () => {
    queue.put()
  }
  unlock()

  return {
    lock,
    unlock,
    // helper for correct usage
    enqueue: async (asyncFn) => {
      await lock()
      try {
        return await asyncFn()
      } finally {
        unlock()
      }
    }
  };
}

// stream creates a stream, which waits for the consumer
// which threads two queues,
// up = for writing values to
// down = for awaiting readiness
export const makeStream = (up, down) => ({
  next(value) {
    up.put({ value, done: false });
    return down.get();
  },
  return(value) {
    up.put({ value, done: true });
    return down.get();
  },
  throw(error) {
    up.put(Promise.reject(error));
    return down.get();
  },
  [Symbol.asyncIterator]() {
    return this;
  },
});

// pipe creates a pipe, for connecting consumer and producer
// output = inbox, for the producer to populate
// input = outbox, for the consumer to read from
export const makePipe = () => {
  const syn = makeQueue();
  const ack = makeQueue();
  const input = makeStream(syn, ack);
  const output = makeStream(ack, syn);
  return [input, output];
};

// pump pulls from one stream and pushes to another.
// The pump slows down for output back-pressure.
// (connects async iter to queue)
// ?? language? stream / async iter?
// output = stream where values are written to
// input = async iter where values are pulled from
export const pump = async (output, input) => {
  try {
    let value, done;
    while ({value, done} = await input.next()) {
      if (done) {
        return output.return(value);
      }
      await output.next(value);
    }
  } catch (error) {
    return output.throw(error);
  }
};

export async function *asyncFlatten(streams) {
  for await (const stream of streams) {
    for await (const value of stream) {
      yield value;
    }
  }
}

export async function *asyncMap(values, callback) {
  for await (const value of values) {
    // ??? await yield await, really?
    await(yield await callback(value));
  }
}

export const parallelMap = (limit, values, callback) => {
  const [input, output] = makePipe();
  parallel(limit, () => pump(input, asyncMap(values, callback)));
  return output;
}

export const delayWithContext = (context, ms) => {
  const { promise, resolve, reject } = makePromiseKit();
  let handle = setTimeout(resolve, ms);
  context.cancelled.catch((error) => {
    reject(error);
    clearTimeout(handle);
  });
  return promise;
};

export const never = makePromiseKit().promise;

export const background = Object.freeze({
  cancelled: never,
  deadline: Infinity,
  with(child) {
    return Object.freeze({
      __proto__: this,
      ...child,
    });
  },
  withTimeout(timeout) {
    const deadline = Date.now() + timeout;
    return this.withTimeoutAndDeadline(timeout, deadline);
  },
  withDeadline(deadline) {
    const timeout = deadline - Date.now();
    return this.withTimeoutAndDeadline(timeout, deadline);
  },
  withTimeoutAndDeadline(timeout, deadline) {
    if (deadline > this.deadline) {
      return this;
    }
    const { cancel, context } =  this.withCancel();
    delayWithContext(this, timeout).then(() => cancel(new Error(`Timed out`)));
    return context.with({ deadline });
  },
  withCancel() {
    const { promise, reject } = makePromiseKit();
    const context = this.with({ cancelled: promise });
    this.cancelled.catch(reject);
    return {cancel: reject, context};
  },
});

export const streamWithContext = (context, stream) => ({
  next(value) {
    return Promise.race([context.cancelled, stream.next(value)]);
  },
  return(value) {
    return Promise.race([context.cancelled, stream.return(value)]);
  },
  throw(error) {
    return Promise.race([context.cancelled, stream.throw(error)]);
  },
  [Symbol.asyncIterator]() {
    return this;
  },
});

// kumavis experiments

export async function *asyncIterFromQueue(queue) {
  while (true) {
    yield await queue.get();
  }
}

export function asyncIterToProducer(asyncGen) {
  return async function producer (output) {
    const input = asyncGen();
    return pump(output, input);
  }
}

export async function connect (producer, consumer) {
  const [input, output] = makePipe();
  await Promise.all([
    producer(output),
    consumer(input),
  ]);
}

export async function pipeline (...duplexes) {
  const connections = []
  for (const _index in duplexes) {
    const index = parseInt(_index)
    if (index === 0) continue
    const source = duplexes[index - 1]
    const dest = duplexes[index]
    connections.push(
      connect(source.producer, dest.consumer)
    )
  }
  await Promise.all(connections)
}

export const deferredQueue = () => {
  const queueP = makePromiseKit();
  return {
    put(value) {
      queueP.promise.then((queue) => {
        queue.put(value)
      })
    },
    get() {
      const promise = queueP.promise.then((queue) => {
        return queue.get()
      })
      return promise
    },
    setQueue(queue) {
      // todo: only allow once
      queueP.resolve(queue)
    }
  }
}

export const deferredStream = () => {
  const left = deferredQueue();
  const right = deferredQueue();
  const _stream = makeStream(left, right);
  const setQueues = (_left, _right) => {
    left.setQueue(_left)
    right.setQueue(_right)
  }
  return { stream: _stream, left, right, setQueues }
}

export const connectDeferred = async (producer, consumer) => {
  const syn = makeQueue()
  const ack = makeQueue()
  // const input = stream(syn, ack);
  consumer.input.setQueues(syn, ack)
  // const output = stream(ack, syn);
  producer.output.setQueues(ack, syn)
  // await completion on both
  await Promise.all([
    producer.done,
    consumer.done,
  ])
}
