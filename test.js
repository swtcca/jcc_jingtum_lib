const Remote = require("./").Remote
const TX = require("./").Transaction
const config = require("./test/config")
const DATA = require("./test/config_data")
const utils = require("swtc-utils")
const axios = require("axios")
const sleep = time => new Promise(res => setTimeout(() => res(), time))

let { JT_NODE, TEST_NODE } = config
let pair = "SWT:JJCC/jGa9J9TkqtBcUoHe2zqhVFFbgUVED6o9or"

const remote = new Remote({server: TEST_NODE, local_sign: true, issuer: config.issuer})

let tx = remote.buildPaymentTx({
  source: DATA.address,
  to: DATA.address2,
  amount: remote.makeAmount(0.1),
  memo: "memo",
  secret: DATA.secret,
  sequence: "100"
})
