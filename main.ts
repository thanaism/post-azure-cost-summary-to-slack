/* eslint-disable @typescript-eslint/no-unused-vars */
const main = () => postToSlack();

const testGenQuery = () => console.log(genQuery());
const testFetchToken = () => console.log(fetchToken());
const testGetDailyTotal = () => console.log(JSON.stringify(getDailyTotal(fetchToken())));
const testGenSlackMessage = (isMonthly = false) => console.log(JSON.stringify({ blocks: genPayload().blocks }));
const testGetMonthlyTotal = () => console.log(getMonthlyTotal(fetchToken()));
const testPostToSlack = () => postToSlack(true);
/* eslint-enable @typescript-eslint/no-unused-vars */

// Azure Auth parameters
const SUBSCRIPTION_ID = PropertiesService.getScriptProperties().getProperty('SUBSCRIPTION_ID') as string;
const TENANT_ID = PropertiesService.getScriptProperties().getProperty('TENANT_ID') as string;
const CLIENT_SECRET = PropertiesService.getScriptProperties().getProperty('CLIENT_SECRET') as string;
const CLIENT_ID = PropertiesService.getScriptProperties().getProperty('CLIENT_ID') as string;
const SLACK_TOKEN = PropertiesService.getScriptProperties().getProperty('SLACK_TOKEN') as string;
const TITLE = PropertiesService.getScriptProperties().getProperty('TITLE') as string;
const COST_MANAGEMENT_URL = PropertiesService.getScriptProperties().getProperty('COST_MANAGEMENT_URL') as string;
const SLACK_CHANNEL = PropertiesService.getScriptProperties().getProperty('SLACK_CHANNEL') as string;
const TEST_SLACK_CHANNEL = PropertiesService.getScriptProperties().getProperty('TEST_SLACK_CHANNEL') as string;

// Query for Cost Management API
const genQuery = (isResourceType = true, isTotal = false, isMonthly = false) => {
  return {
    dataset: {
      aggregation: { totalCost: { function: 'Sum', name: 'PreTaxCost' } },
      granularity: isMonthly ? 'Monthly' : 'Daily',
      grouping: isTotal ? [] : [{ name: isResourceType ? 'ResourceType' : 'ResourceGroup', type: 'Dimension' }],
    },
    timePeriod: isMonthly
      ? null
      : {
          from: getDateBefore(7, '-') + 'T00:00:00.000Z',
          to: getDateBefore(0, '-') + 'T00:00:00.000Z',
        },
    timeframe: isMonthly ? 'BillingMonthToDate' : 'Custom',
    type: 'Usage',
  };
};

// Azure Auth
const fetchToken = (): string => {
  const clientInfo = `client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}`;
  const payload = `${clientInfo}&grant_type=client_credentials&resource=https%3A%2F%2Fmanagement.core.windows.net%2F`;
  const options = {
    headers: { contentType: 'application/x-www-form-urlencoded' },
    method: 'post',
    payload: payload,
  };
  const url = 'https://login.microsoftonline.com/' + TENANT_ID + '/oauth2/token';
  const res = UrlFetchApp.fetch(url, options as GoogleAppsScript.URL_Fetch.URLFetchRequestOptions);
  const token: string = (JSON.parse(res.getContentText()) as { access_token: string }).access_token;
  return token;
};

// POST to Cost Management API
const fetchCostManagementRawJSON = (token: string, query: Query): CostManagementRawJSON => {
  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    muteHttpExceptions: true,
    contentType: 'application/json',
    headers: { Authorization: `Bearer ${token}` },
    method: 'post',
    payload: JSON.stringify(query),
  };
  const url = `https://management.azure.com/subscriptions/${SUBSCRIPTION_ID}/providers/Microsoft.CostManagement/query?api-version=2019-11-01`;
  const res = UrlFetchApp.fetch(url, options).getContentText();
  return JSON.parse(res) as CostManagementRawJSON;
};

const getTypeData = (token: string, dayBefore: number) => getData(token, dayBefore, true);

const getGroupData = (token: string, dayBefore: number) => getData(token, dayBefore, false);

const getData = (token: string, dayBefore: number, isResourceType: boolean, isMonthly = false) => {
  const res = fetchCostManagementRawJSON(token, genQuery(isResourceType, (isMonthly = isMonthly)));
  return res.properties.rows.flatMap((e) => (String(e[1]) == getDateBefore(dayBefore, '') ? [e] : []));
};

const getDailyTotal = (token: string) => {
  const res = fetchCostManagementRawJSON(token, genQuery(false, true));
  return Object.fromEntries(res.properties.rows.map((a) => [a[1], a[0]]));
};

const getMonthlyTotal = (token: string) => {
  const res = fetchCostManagementRawJSON(token, genQuery(false, true, true));
  return res.properties.rows[0][0];
};

const getDateBefore = (dayCount = 0, sep: string) => {
  const date = new Date();
  date.setDate(date.getDate() - dayCount);
  const yyyy = date.getFullYear();
  const mm = `0${date.getMonth() + 1}`.slice(-2);
  const dd = `0${date.getDate()}`.slice(-2);
  return [yyyy, sep, mm, sep, dd].join('');
};

const postToSlack = (isTest = false) => {
  const url = 'https://slack.com/api/chat.postMessage';
  const payload = genPayload(isTest);
  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method: 'post',
    headers: { Authorization: `Bearer ${SLACK_TOKEN}`, 'Content-Type': 'application/json' },
    payload: JSON.stringify(payload),
  };
  UrlFetchApp.fetch(url, options);
};

const payloadDailyTotal = (token: string) => {
  const totalCost = getDailyTotal(token);
  return [...(Array(7) as unknown[])]
    .map((_, i) => 7 - i)
    .slice(0, Math.min(7, Object.keys(totalCost).length))
    .map((i) => `${getDateBefore(i, '/')}: *${totalCost[getDateBefore(i, '')] | 0} yen* \n`)
    .join('');
};

const emojiDigits = [
  ':one:',
  ':two:',
  ':three:',
  ':four:',
  ':five:',
  ':six:',
  ':seven:',
  ':eight:',
  ':nine:',
  ':keycap_ten:',
];

const payloadTypeData = (token: string) => {
  const typeData = getTypeData(token, 2);
  typeData.sort((a, b) => (b[0] > a[0] ? 1 : -1));
  return emojiDigits
    .slice(0, Math.min(10, typeData.length))
    .map((v, i) => `${v} ${typeData[i][2].replace(/microsoft./, '')}: *${typeData[i][0] | 0} yen* \n`)
    .join('');
};

const payloadGroupData = (token: string) => {
  const groupData = getGroupData(token, 2);
  groupData.sort((a, b) => (b[0] > a[0] ? 1 : -1));
  return emojiDigits
    .slice(0, Math.min(10, groupData.length))
    .map((v, i) => `${v} ${groupData[i][2]}: *${groupData[i][0] | 0} yen* \n`)
    .join('');
};

const genPayload = (isTest = false): Payload => {
  const token = fetchToken();
  return {
    channel: isTest ? TEST_SLACK_CHANNEL : SLACK_CHANNEL,
    blocks: [
      {
        type: 'context',
        elements: [{ text: `*${getDateBefore(0, '/')}*  |  ${TITLE}`, type: 'mrkdwn' }],
      },
      {
        type: 'context',
        elements: [{ text: `*Monthly total: ${getMonthlyTotal(token) | 0} yen*`, type: 'mrkdwn' }],
      },
      { type: 'divider' },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: ' :loud_sound: *DAILY COST* :loud_sound:' },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: payloadDailyTotal(token) },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: 'View in Cost Management', emoji: true },
          url: COST_MANAGEMENT_URL,
        },
      },
      { type: 'divider' },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*TOP 10 RESOURCE TYPE* (${getDateBefore(2, '/')})` },
      },
      { type: 'section', text: { type: 'mrkdwn', text: payloadTypeData(token), verbatim: false } },
      { type: 'divider' },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*TOP 10 RESOURCE GROUP* (${getDateBefore(2, '/')})` },
      },
      { type: 'section', text: { type: 'mrkdwn', text: payloadGroupData(token), verbatim: false } },
      { type: 'divider' },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: ':pushpin: Do you have any request? Please send a mesage to hifumi.',
          },
        ],
      },
    ],
  };
};

// Types
type Query = {
  dataset: {
    aggregation: { totalCost: { function: string; name: string } };
    granularity: string;
    grouping: { name: string; type: string }[];
  };
  timePeriod: null | { from: string; to: string };
  timeframe: string;
  type: string;
};

type Payload = {
  blocks: object;
  channel: string;
  [key: string]: object | string;
};

type CostManagementRawJSON = {
  properties: { rows: [number, number, string][] };
};
