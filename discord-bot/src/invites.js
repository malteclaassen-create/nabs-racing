// snapshot = { [code]: { uses, inviterId } }

// which invite got used between two snapshots -> inviter id, or null if unclear.
// unclear = nothing moved, or more than one moved. better no credit than the wrong one.
export function inviteUsed(before, after) {
  const risen = [];
  for (const [code, now] of Object.entries(after || {})) {
    const then = before?.[code];
    const was = then ? Number(then.uses) || 0 : 0;
    const is = Number(now?.uses) || 0;
    if (is > was) risen.push({ code, inviterId: now.inviterId, by: is - was });
  }
  if (!risen.length) {
    // single-use invites get deleted by discord when used
    const gone = Object.entries(before || {}).filter(([code]) => !(code in (after || {})));
    if (gone.length === 1 && gone[0][1]?.inviterId) return gone[0][1].inviterId;
    return null;
  }
  if (risen.length > 1) return null;
  return risen[0].inviterId || null;
}

export function snapshotFrom(invites) {
  const out = {};
  for (const invite of invites) {
    if (!invite?.code) continue;
    out[invite.code] = {
      uses: Number(invite.uses) || 0,
      inviterId: invite.inviterId || invite.inviter?.id || null,
    };
  }
  return out;
}
