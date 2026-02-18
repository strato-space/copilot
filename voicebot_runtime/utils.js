require("dotenv-expand").expand(require("dotenv").config());
const config = process.env;

const log4js = require("log4js");

const fetch = require("node-fetch");
const AbortController = require("abort-controller");

const initLogger = (name, path, processInstance) => {
  log4js.configure({
    appenders: {
      out: { type: "stdout", layout: { type: "basic" } },
      file: {
        type: "file",
        filename: `${config.LOGS_DIR
          }/${path}/${processInstance}-${name
            .toLowerCase()
            .split(" ")
            .join("_")}.log`,
        maxLogSize: 10485760,
        backups: 3,
        compress: true,
      },
    },
    categories: {
      default: { appenders: ["out", "file"], level: config.LOGS_LEVEL },
    },
    disableClustering: true,
  });
  return log4js.getLogger(`${name} #${processInstance}`);
};

const delay = (ms) => {
  return new Promise((resolve, reject) => {
    setTimeout(resolve, ms);
  });
};

const random = (min, max) =>
  Math.floor(Math.random() * (parseInt(max, 10) - parseInt(min, 10) + 1)) +
  parseInt(min, 10);


function splitArray(arr, n) {
  var rest = arr.length % n, // how much to divide
    restUsed = rest, // to keep track of the division over the elements
    partLength = Math.floor(arr.length / n),
    result = [];

  for (var i = 0; i < arr.length; i += partLength) {
    var end = partLength + i,
      add = false;

    if (rest !== 0 && restUsed) {
      // should add one element for the division
      end++;
      restUsed--; // we've used one division element now
      add = true;
    }

    result.push(arr.slice(i, end)); // part of the array

    if (add) {
      i++; // also increment i in the case we added an extra element for division
    }
  }
  return result;
}


function randomInteger(min, max) {
  return Math.floor(Math.random() * (Math.round(max) - Math.round(min) + 1)) + Math.round(min);
}

async function retriableFetch(url, fetch_config = null) {

  const defaultConfig = {
    is_json: true,
    timeout: 30000,
    delay_min: 0,
    delay_max: 0,
    tries: 3,
    proxy: null,
    logger: null,
    method: 'GET',
    headers: {},
    body: null,
  }

  fetch_config = Object.assign(defaultConfig, fetch_config);

  let logger = fetch_config.logger;

  if (logger == null) {
    logger = {
      info: (text) => console.log(text),
      error: (error) => console.error(error)
    }
  }

  let result = [];
  let finished = false;
  let tries = 0;

  while (!finished) {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, fetch_config.timeout);

    try {
      await delay(randomInteger(fetch_config.delay_min, fetch_config.delay_max));
      logger.info("Fetcher: Fetching data");

      const response = await fetch(url, {
        agent: fetch_config.proxy,
        signal: controller.signal,
        method: fetch_config.method,
        headers: fetch_config.headers,
        body: fetch_config.body
      });

      if (fetch_config.is_json) {
        const data = await response.json();
        result = data;
      } else {
        result = response;
      }

      finished = true;
    } catch (e) {
      if (e.name == "AbortError") {
        logger.error("Fetcher: the request is time out");
      } else {
        logger.error(e);
      }
      finished = false;
      tries++;
    } finally {
      clearTimeout(timeout);
    }
    if (tries >= fetch_config.tries) {
      logger.error("Fetcher: Cannot fetch data");
      throw "Cannot fetch data";
    }
  }

  logger.info("Fetcher: Data fetched");
  return result;
}

function AsyncPolling(pollingFunc, onResult, delay) {
  if (!(this instanceof AsyncPolling)) {
    return new AsyncPolling(pollingFunc, onResult, delay)
  }
  this._pollingFunc = pollingFunc.bind(this, pollCallback.bind(this));
  this._onResult = onResult.bind(this);

  this._delay = delay.valueOf();

  this._timer = null;
  this._mustSchedule = false;
}

AsyncPolling.prototype.run = function run() {
  this._mustSchedule = true;
  poll.call(this);
};

AsyncPolling.prototype.stop = function AsyncPolling_stop() {
  this._mustSchedule = false;
  if (this._timer !== null) {
    clearTimeout(this._timer);
    this._timer = null;
  }
};

function poll() {
  this._pollingFunc();
}

function pollCallback(error, result) {
  this._onResult(result)

  if (this._mustSchedule) {
    this._timer = setTimeout(poll.bind(this), this._delay);
  }
};




module.exports = {
  initLogger,
  delay,
  random,
  splitArray,
  retriableFetch,
  AsyncPolling,
};
