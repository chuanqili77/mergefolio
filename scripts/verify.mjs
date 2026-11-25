import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { reader, read, finality, succeeded } from '../chain.js';
import deployment from '../deployment.json' with { type: 'json' };
import sample from '../evidence/browser-sample.json' with { type: 'json' };

const { address } = deployment;
const source = await readFile('contracts/mergefolio.py', 'utf8');
assert.equal(await reader.getChainId(), deployment.chainId);
assert.equal(await reader.getContractCode(address), source);
assert.equal(createHash('sha256').update(source).digest('hex'), deployment.sourceSha256);

const transactions = await Promise.all([{ operation: 'Deployment', hash: deployment.hash, execution: 'SUCCESS' }, ...sample.transactions].map(async entry => {
  const tx = await finality(entry.hash);
  assert.equal(tx.statusName, 'FINALIZED');
  assert.equal(tx.txExecutionResultName, entry.execution);
  assert.equal(succeeded(tx), entry.execution === 'SUCCESS');
  if (entry.signer) {
    assert.equal(tx.from_address.toLowerCase(), entry.signer.toLowerCase());
    assert.equal(tx.to_address.toLowerCase(), address.toLowerCase());
  }
  const nodeReceipts = [tx.consensus_data?.leader_receipt].flat().filter(Boolean);
  const leader = nodeReceipts.find(record => record.mode === 'leader') ?? nodeReceipts[0];
  if (entry.credential) assert(leader?.eq_outputs && Object.keys(leader.eq_outputs).length, 'Missing equivalence result');
  return { ...entry, status: tx.statusName, consensus: tx.result_name, from: tx.from_address,
    equivalenceOutputs: leader?.eq_outputs, failure: entry.execution === 'ERROR' ? tx.reason : undefined };
}));

const recordView = async id => JSON.parse(await read(address, 'get_record', [BigInt(id)]) || 'null');
const profileView = async id => JSON.parse(await read(address, 'get_profile', [BigInt(id)]) || 'null');
const credentials = sample.transactions.filter(entry => entry.credential);
const records = await Promise.all(credentials.map(entry => recordView(entry.credential.id)));
for (const [i, actual] of records.entries()) {
  const entry = credentials[i];
  assert.equal(actual.number, entry.credential.pr);
  assert.equal(actual.result, entry.credential.result);
  assert.equal(actual.author_id, entry.credential.authorId);
  assert.equal(actual.nominator.toLowerCase(), entry.signer.toLowerCase());
}
const issued = records.find(record => record.result === 'ISSUED');
assert(issued);
assert.notEqual(issued.author_id, issued.merger_id);
const count = Number(await read(address, 'record_count'));
assert.equal(count, sample.finalCount);
assert.equal(await recordView(count + 1), null);
const profile = await profileView(issued.author_id);
assert.equal(profile.proofs, 1);
assert.equal(profile.owners, 1);
assert.equal(profile.level, 'MERGE_VERIFIED');
assert.equal(Number(await read(address, 'get_profile_record', [BigInt(issued.author_id), 1n])),
  credentials.find(entry => entry.credential.result === 'ISSUED').credential.id);
assert.equal(Number(await read(address, 'get_profile_record', [BigInt(issued.author_id), 2n])), 0);
const output = { address, sourceSha256: deployment.sourceSha256, network: 'Stable Studionet 61999',
  transactions, latestFinal: { count, records, profile } };
if (process.argv.includes('--write')) await writeFile('evidence/studionet.json', JSON.stringify(output, null, 2) + '\n');
console.log('Verified deployment identity, browser transactions and latest-final attribution.');
