import { createAccount, createClient } from 'genlayer-js';
import { formatEther } from 'viem';
import deployment from './deployment.json';
import { chain, reader, rpc, read, finality, succeeded, explorer, transactionFees, fundTestWallet } from './chain.js';
import './style.css';

const $ = id => document.getElementById(id);
const address = deployment.address;
const providers = new Map();
const demos = [];
let wallet;
let busy = false;
let readFailed = false;
let profileId = '';
let offset = 0;
let refreshVersion = 0;

function node(tag, text, parent) {
  const element = document.createElement(tag);
  element.textContent = text;
  parent.append(element);
  return element;
}
function message(text, hash) {
  $('message').textContent = text;
  if (hash) {
    $('tx').href = explorer + '/transactions/' + hash;
    $('tx').hidden = false;
  }
}
function permissions() {
  $('fund').hidden = !wallet?.account;
  $('verify').disabled = busy || readFailed || wallet?.network !== 61999;
  document.querySelectorAll('[data-wallet], #demo, #disconnect, #reset, #switch, #demo-list, #fund, #lookup button, #reload, #show-ledger').forEach(button => button.disabled = busy);
  $('eligibility').textContent = readFailed ? 'Refresh the finalized ledger before submitting again.' :
    !wallet ? 'Connect a wallet to nominate a pull request.' :
    wallet.network !== 61999 ? 'Switch to Stable Studionet to sign.' :
    'The on-chain record will include your nominating wallet.';
}

async function syncWallet() {
  const current = wallet;
  if (!current) {
    $('identity').textContent = 'No wallet connected.';
    $('switch').hidden = true;
    permissions();
    return;
  }
  try {
    if (current.provider) {
      const [accounts, network] = await Promise.all([
        current.provider.request({ method: 'eth_accounts' }),
        current.provider.request({ method: 'eth_chainId' }),
      ]);
      if (wallet !== current) return;
      if (!accounts.length) return disconnect();
      current.address = accounts[0];
      current.network = Number(network);
    }
    $('switch').hidden = !current.provider || current.network === 61999;
    const label = current.name + ' · ' + current.address + ' · Chain ' + current.network;
    $('identity').textContent = label;
    permissions();
    if (current.network === 61999) {
      const balance = await reader.getBalance({ address: current.address });
      if (wallet === current) $('identity').textContent = label + ' · ' + formatEther(balance) + ' test GEN';
    }
  } catch {
    if (wallet !== current) return;
    current.network = 0;
    $('identity').textContent = 'Wallet or RPC unavailable. Reconnect to continue.';
    permissions();
  }
}
const accountChange = () => { void syncWallet(); };
function disconnect() {
  if (wallet?.provider) {
    for (const event of ['accountsChanged', 'chainChanged']) wallet.provider.removeListener?.(event, accountChange);
    wallet.provider.removeListener?.('disconnect', disconnect);
  }
  wallet = undefined;
  $('demo-list').value = '';
  void syncWallet();
}
window.addEventListener('eip6963:announceProvider', event => {
  const { info, provider } = event.detail;
  providers.set(info.rdns, provider);
});
window.dispatchEvent(new Event('eip6963:requestProvider'));
for (const button of document.querySelectorAll('[data-wallet]')) button.onclick = async () => {
  const name = button.dataset.wallet;
  const provider = name === 'MetaMask'
    ? providers.get('io.metamask') || (window.ethereum?.isMetaMask ? window.ethereum : undefined)
    : providers.get('com.okex.wallet') || providers.get('com.okx.wallet') || window.okxwallet;
  if (!provider) return message(name + ' was not found in this browser.');
  try {
    await provider.request({ method: 'eth_requestAccounts' });
    disconnect();
    wallet = { provider, name };
    for (const event of ['accountsChanged', 'chainChanged']) provider.on?.(event, accountChange);
    provider.on?.('disconnect', disconnect);
    await syncWallet();
  } catch { message('Wallet connection was declined or unavailable.'); }
};
$('switch').onclick = async () => {
  const provider = wallet?.provider;
  if (!provider) return;
  const chainId = '0xf22f';
  try {
    try { await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] }); }
    catch (error) {
      if (error.code !== 4902) throw error;
      await provider.request({ method: 'wallet_addEthereumChain', params: [{
        chainId, chainName: 'Stable Studionet', rpcUrls: [rpc],
        nativeCurrency: { name: 'GEN', symbol: 'GEN', decimals: 18 }, blockExplorerUrls: [explorer],
      }] });
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
    }
    await syncWallet();
  } catch { message('The network change was declined or unavailable.'); }
};
function selectDemo(index) {
  disconnect();
  const account = demos[index];
  wallet = { account, address: account.address, network: 61999, name: 'Demo / Test Wallet ' + (index + 1) };
  $('demo-list').value = index;
  void syncWallet();
}
$('demo').onclick = () => {
  demos.push(createAccount());
  const index = demos.length - 1;
  const choice = node('option', 'Demo wallet ' + (index + 1), $('demo-list'));
  choice.value = index;
  $('demo-list').hidden = false;
  selectDemo(index);
};
$('demo-list').onchange = () => { if ($('demo-list').value !== '') selectDemo(Number($('demo-list').value)); };
$('disconnect').onclick = disconnect;
$('fund').onclick = async () => {
  const current = wallet;
  if (!current?.account || !confirm('Request 1 test GEN from the Studionet faucet for ' + current.address + '?')) return;
  try {
    await fundTestWallet(current.address);
    await syncWallet();
    message('Studionet faucet request completed. Check your displayed balance.');
  } catch { message('Studionet faucet was unavailable. Try again later.'); }
};
$('reset').onclick = () => {
  if (!confirm('Discard all temporary Demo wallet keys in this tab?')) return;
  if (wallet?.account) disconnect();
  demos.length = 0;
  $('demo-list').replaceChildren();
  $('demo-list').hidden = true;
};
$('wallet-toggle').onclick = () => {
  $('wallet-panel').hidden = !$('wallet-panel').hidden;
  $('wallet-toggle').setAttribute('aria-expanded', String(!$('wallet-panel').hidden));
};

const decisions = {
  ISSUED: ['Credential issued', 'A GitHub account other than the author merged this pull request.'],
  OPEN: ['Still open', 'GitHub reports that this pull request has never been merged. You can nominate it again if the status changes.'],
  CLOSED_UNMERGED: ['Closed without a merge', 'GitHub reports no merge. This submission does not contribute to the author’s folio.'],
  SELF_MERGE: ['Self-merged', 'GitHub identifies the same account as author and merger. No credential was issued.'],
};
function link(text, url, parent) {
  const anchor = node('a', text, parent);
  anchor.href = url;
  anchor.target = '_blank';
  anchor.rel = 'noopener';
  return anchor;
}
let example = {};
fetch(new URL('./evidence-index.json', location.href)).then(response => response.ok ? response.json() : {}).then(index => { example = index; }).catch(() => {});
const sessionReceipts = new Map();
function renderRecord(id, record) {
  const details = node('details', '', $('records'));
  details.className = 'record';
  const heading = node('summary', '#' + id + ' · ' + record.repository + ' #' + record.number, details);
  node('span', decisions[record.result][0], heading).className = 'seal' + (record.result === 'ISSUED' ? '' : ' blocked');
  node('p', decisions[record.result][1], details);
  const identity = node('p', 'Credited account ', details);
  const profileLink = node('a', '@' + record.author + ' · ID ' + record.author_id, identity);
  profileLink.href = '?author=' + record.author_id;
  node('p', 'Nominated by ' + record.nominator, details);
  if (record.merged_at) node('p', 'Merged ' + record.merged_at + ' · merger account ID ' + record.merger_id, details);
  if (record.result !== 'ISSUED') identity.firstChild.textContent = 'PR author ';
  const sources = node('p', '', details);
  link('GitHub pull request ↗', 'https://github.com/' + record.repository + '/pull/' + record.number, sources);
  const hash = sessionReceipts.get(String(id)) || example[id]?.hash;
  if (hash) {
    sources.append(' · ');
    link('Explorer receipt ↗', explorer + '/transactions/' + hash, sources);
  }
}

async function refresh() {
  const version = ++refreshVersion;
  const selected = profileId;
  const currentOffset = offset;
  const profile = selected ? JSON.parse(await read(address, 'get_profile', [BigInt(selected)]) || 'null') : null;
  const count = selected ? profile?.proofs || 0 : Number(await read(address, 'record_count'));
  const remaining = Math.max(0, count - currentOffset);
  const rows = await Promise.all(Array.from({ length: Math.min(remaining, 8) }, async (_, index) => {
    const number = BigInt(remaining - index);
    const id = selected ? await read(address, 'get_profile_record', [BigInt(selected), number]) : number;
    const raw = await read(address, 'get_record', [id]);
    if (!raw) throw new Error('Missing finalized record');
    return [id, JSON.parse(raw)];
  }));
  if (version !== refreshVersion) return;
  $('profile').replaceChildren();
  $('records').replaceChildren();
  if (selected) {
    const card = node('div', '', $('profile'));
    card.className = 'profile-card';
    node('h3', profile ? '@' + profile.author : 'Account ' + selected, card);
    node('p', profile ? profile.proofs + ' verified merges · ' + profile.owners + ' distinct owner accounts · ' +
      (profile.level === 'MULTI_OWNER' ? 'Multiple owners verified' : 'Third-party merge verified') :
      'No credentials have been issued for this account.', card);
    const permalink = node('a', 'Share this folio', card);
    permalink.href = '?author=' + selected;
  }
  if (!rows.length) node('p', 'No records in this view.', $('records'));
  for (const [id, record] of rows) renderRecord(id, record);
  if (remaining > 8) node('button', 'Older decisions', $('records')).onclick = () => browse(selected, currentOffset + 8);
  if (currentOffset) node('button', 'Newer decisions', $('records')).onclick = () => browse(selected, Math.max(0, currentOffset - 8));
  readFailed = false;
  permissions();
}
async function browse(id = '', page = 0) {
  profileId = id;
  offset = page;
  try {
    await refresh();
    if ($('message').textContent.startsWith('Finalized state could not be read')) message('Browsing finalized state.');
  }
  catch { message('Finalized state could not be read. Use Refresh to try again.'); }
}
$('lookup').onsubmit = event => { event.preventDefault(); void browse($('author-id').value); };
$('show-ledger').onclick = () => browse();
$('reload').onclick = () => browse(profileId, offset);
$('contract').href = explorer + '/address/' + address;

function parsePull(value) {
  const url = new URL(value);
  const match = /^\/([a-z0-9-]{1,39})\/([a-z0-9_.-]{1,100})\/pull\/([1-9][0-9]{0,9})\/?$/i.exec(url.pathname);
  if (url.origin !== 'https://github.com' || url.username || url.password || !match || Number(match[3]) > 2147483647) throw new Error('Enter a public github.com pull request URL.');
  return [match[1].toLowerCase(), match[2].toLowerCase(), BigInt(match[3])];
}
$('nomination').onsubmit = async event => {
  event.preventDefault();
  if (busy || readFailed || !wallet || wallet.network !== 61999) return;
  let args;
  try { args = parsePull(new FormData(event.target).get('pull')); }
  catch { return message('Enter a public GitHub pull request URL, including its PR number.'); }
  const chosen = wallet;
  const signer = chosen.address;
  busy = true;
  permissions();
  let hash;
  try {
    const fees = await transactionFees();
    const subject = args[0] + '/' + args[1] + ' #' + args[2];
    if (!confirm('Verify ' + subject + '\n' + signer + '\nStable Studionet · 61999\nFee deposit: ' + formatEther(fees.feeValue) + ' test GEN')) return;
    if (wallet !== chosen) throw new Error('Wallet changed before signing.');
    if (chosen.provider) {
      const [accounts, network] = await Promise.all([
        chosen.provider.request({ method: 'eth_accounts' }), chosen.provider.request({ method: 'eth_chainId' }),
      ]);
      if (wallet !== chosen || Number(network) !== 61999 || accounts[0]?.toLowerCase() !== signer.toLowerCase()) {
        throw new Error('Wallet identity or network changed. Review the new identity and retry.');
      }
    }
    message('Waiting for signature…');
    const client = createClient({ chain, account: chosen.account || signer, provider: chosen.provider });
    hash = await client.writeContract({ address, functionName: 'nominate', args, value: 0n, leaderOnly: false, fees });
    message('Submitted. Waiting for consensus…', hash);
    const tx = await finality(hash, status => message('Consensus status · ' + status, hash));
    if (!succeeded(tx)) {
      return message('Verification did not execute: ' + tx.statusName + ' · ' + (tx.txExecutionResultName || 'unknown') +
        '. The pull request may already be recorded, private, or temporarily unavailable. Check the Explorer receipt and recent decisions before retrying.', hash);
    }
    try {
      profileId = '';
      offset = 0;
      const count = Number(await read(address, 'record_count'));
      for (let i = count; i > Math.max(0, count - 8); i--) {
        const record = JSON.parse(await read(address, 'get_record', [BigInt(i)]));
        if (record.repository === args[0] + '/' + args[1] && record.number === Number(args[2]) && record.nominator.toLowerCase() === signer.toLowerCase()) {
          sessionReceipts.set(String(i), hash);
          break;
        }
      }
      await refresh();
      message('Finalized · Execution succeeded. Check the credential decision in the ledger.', hash);
    } catch {
      readFailed = true;
      message('Execution succeeded, but finalized state could not be read. Use Refresh before submitting again.', hash);
    }
  } catch (error) {
    message(hash ? error.message : error.code === 4001 ? 'Signature declined.' : 'Could not submit. ' + (error.shortMessage || error.message), hash);
  } finally {
    busy = false;
    permissions();
    void syncWallet();
  }
};
const requested = new URLSearchParams(location.search).get('author') || '';
if (/^[1-9][0-9]{0,19}$/.test(requested)) $('author-id').value = requested;
permissions();
void browse($('author-id').value);
