import {describe,it,expect,vi} from 'vitest';
import {telemetryIdentities} from './telemetryIdentity.js';

describe('telemetry team identity',()=>{
  it('uses the requested season for the same Steam identity, with display-name overrides',async()=>{
    const roster=[
      {id:'old',seasonId:'s7',steamId:'123',name:'Alex',team:{id:'old-team',name:'Old team',color:'#ff0000'}},
      {id:'new',seasonId:'s8',steamId:'123',name:'Alex',team:{id:'new-team',name:'New team',color:'#00ffff',logoUrl:'/teams/new.png'}},
    ];
    const prisma={driver:{findMany:vi.fn(async({where})=>roster.filter(d=>d.seasonId===where.seasonId&&where.steamId.in.includes(d.steamId)))}};
    const result=await telemetryIdentities(prisma,['123','123','999'],'s8',new Map([['new',{displayName:'Alex Morgan'}]]));
    expect(result.get('123')).toEqual({driverId:'new',name:'Alex Morgan',team:roster[1].team});
    expect(result.has('999')).toBe(false);
    expect([...result.keys()]).toEqual(['123']);
  });
  it('does not borrow a team when the season cannot be resolved',async()=>{
    const prisma={driver:{findMany:vi.fn()}};
    expect((await telemetryIdentities(prisma,['123'],null)).size).toBe(0);
    expect(prisma.driver.findMany).not.toHaveBeenCalled();
  });
});
