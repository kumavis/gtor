import {
  // util
  count, delay, delayWithContext, background,
  // async
  asyncForEach, asyncFlatten, asyncMap,
  // parallel
  parallelForEach, parallelMap, parallelReduce,
  // stream
  stream, streamWithContext, pipe, pump,
  // kumavis
  asyncIterToProducer, connect, pipeline,
  deferredStream, connectDeferred,
} from '../src/index.js'

const demoAsyncForEach = async () => {
  console.log('demo serial async for each');
  await asyncForEach(count(10), async (n) => {
    await delay(Math.random() * 100);
    console.log(n);
  });
};

const demoParallelForEach = async () => {
  console.log('demo parallel async for each');
  await parallelForEach(5, count(20), async (n) => {
    await delay(Math.random() * 100);
    console.log(n);
  });
};

const demoParallelReduce = async () => {
  console.log('demo parallel reduce');

  const sum = await parallelReduce(10, 0, count(10), async (a, b) => {
    if (a == 0) {
      return b;
    }
    await delay(Math.random() * 100);
    console.log(a, '+', b, '=', a + b);
    return a + b;
  });

  console.log(sum);
};

const demoPipe = async () => {
  console.log('demo pipe');

  // eager producer
  const producer = async (output) => {
    for (const token of count(10)) {
      console.log(token, '->');
      await output.next(token);
    }
    output.return();
  };

  const consumer = async (input) => {
    for await (const token of input) {
      console.log('->', token);
      await delay(Math.random() * 100);
    }
  };

  const [input, output] = pipe();

  await Promise.all([
    producer(output),
    consumer(input),
  ]);
};

const demoPump = async () => {
  console.log('demo pump');

  // lazy producer
  async function *producer() {
    for (const token of count(10)) {
      console.log(token, '->');
      // ??? await yield?
      await(yield token);
    }
  };

  const consumer = async (input) => {
    for await (const token of input) {
      console.log('->', token);
      await delay(Math.random() * 100);
    }
  };

  const [input, output] = pipe();

  await Promise.all([
    pump(output, producer()),
    consumer(input),
  ]);
};

const demoAsyncFlatten = async () => {
  console.log('demo async flatten');
  for await (const value of asyncFlatten([count(3), count(3)])) {
    console.log(value);
  }
};

const demoAsyncFlattenMap = async () => {
  console.log('demo async flatten');
  const streams = asyncMap(count(3), () => count(3));
  for await (const value of asyncFlatten(streams)) {
    console.log(value);
  }
};

const demoParallelMap = async () => {
  console.log('demo parallel map');
  const streams = parallelMap(7, count(3), async n => {
    await delay(Math.random() * 100);
    return asyncMap(count(5), async m => {
      await delay(Math.random() * 100);
      return (m+1) * 10 + n;
    })
  });
  for await (const value of asyncFlatten(streams)) {
    console.log(value);
  }
};

const demoStreamTimeout = async () => {
  console.log('streaming with a timeout');
  const context = background.withTimeout(1000);
  const stream = streamWithContext(context, count(1000));
  try {
    await parallelForEach(10, stream, async (n) => {
      await delayWithContext(context, Math.random() * 1000);
      console.log(n);
    });
  } catch (error) {
    console.log(error.message);
  }
};

// kumavis experiments

const demoConnect = async () => {
  console.log('demo connect');

  // lazy producer
  async function *producer() {
    for (const token of count(10)) {
      console.log(token, '->');
      // ??? await yield?
      await(yield token);
    }
  };

  const consumer = async (input) => {
    for await (const token of input) {
      console.log('->', token);
      await delay(Math.random() * 100);
    }
  };

  await connect(
    asyncIterToProducer(producer),
    consumer
  );

};


const demoDuplex = async () => {
  console.log('demo duplex');

  const network = {
    async producer (output) {
      for (const token of count(10)) {
        console.log('network.inbound <--', token);
        await output.next(token);
      }
      output.return();
    },
    async consumer (input) {
      for await (const token of input) {
        console.log('network.outbound -->', token);
        await delay(Math.random() * 100);
      }
    },
  };

  // hold it
  // const encoding = {
  //   async producer (output) {
  //     for (const token of count(10)) {
  //       console.log('node.inbound <--', token);
  //       await output.next(token);
  //     }
  //     output.return();
  //   },
  //   async consumer (input) {
  //     for await (const token of input) {
  //       console.log('node.outbound -->', token);
  //       await delay(Math.random() * 100);
  //     }
  //   },
  // };

  const node = {
    async producer (output) {
      for (const token of count(10)) {
        console.log('node.inbound <--', token);
        await output.next(token);
      }
      output.return();
    },
    async consumer (input) {
      for await (const token of input) {
        console.log('node.outbound -->', token);
        await delay(Math.random() * 100);
      }
    },
  };
  
  await pipeline(
    network,
    node,
    network,
  )

};

async function demoConnectDeferred () {

  function makeProducer () {
    const output = deferredStream()
    const outputStream = output.stream

    async function producer () {
      for (const token of count(10)) {
        console.log('node.inbound <--', token);
        await outputStream.next(token);
      }
      outputStream.return();
    }

    return {
      output,
      done: producer(),
    }
  }

  function makeConsumer () {
    const input = deferredStream()
    const inputStream = input.stream

    async function consumer () {
      for await (const token of inputStream) {
        console.log('node.outbound -->', token);
        await delay(Math.random() * 100);
      }
    }

    return {
      input,
      done: consumer(),
    }
  }

  await connectDeferred(
    makeProducer(),
    makeConsumer(),
  )

}




(async () => {
  await demoAsyncForEach();
  await demoParallelForEach();
  await demoParallelReduce();
  await demoAsyncFlatten();
  await demoAsyncFlattenMap();
  await demoParallelMap();
  await demoPipe();
  await demoPump();
  await demoStreamTimeout();
  await demoConnect();
  await demoDuplex();
  await demoConnectDeferred();
})();