// Replay only: a request answered from the record fires no upload progress/load/loadend (Playwright's route.fulfill); a live upload does. Fire them, with the
// body's full size, when the answer's headers arrive (before the page's own load handlers see the response).
/* global window, ProgressEvent */
(() => {
  const Xhr = window.XMLHttpRequest, send = Xhr.prototype.send;
  Xhr.prototype.send = function (body) {
    const size = body instanceof Blob ? body.size : body instanceof FormData ? [...body.values()].reduce((sum, value) => sum + (value instanceof Blob ? value.size : String(value).length), 0) : body ? String(body).length : 0;
    if (body) {
      let fired = false;
      const real = () => { fired = true; };
      this.upload.addEventListener('load', real);
      this.addEventListener('readystatechange', () => {
        if (this.readyState < 2 || fired) return;
        fired = true;
        for (const name of ['progress', 'load', 'loadend']) this.upload.dispatchEvent(new ProgressEvent(name, {lengthComputable: true, loaded: size, total: size}));
      });
    }
    return send.call(this, body);
  };
})();
