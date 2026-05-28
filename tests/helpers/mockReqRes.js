'use strict';

function mockReq({ method = 'GET', headers = {}, query = {}, body = null } = {}) {
  return {
    method,
    headers: { origin: 'https://amitcsenita.github.io', ...headers },
    query,
    body,
  };
}

function mockRes() {
  const r = {
    _status: null,
    _body:   undefined,
    _ended:  false,
    headers: {},
    status(code)    { this._status = code; return this; },
    json(data)      { this._body   = data; return this; },
    end()           { this._ended  = true; return this; },
    setHeader(k, v) { this.headers[k] = v; return this; },
  };
  return r;
}

module.exports = { mockReq, mockRes };
