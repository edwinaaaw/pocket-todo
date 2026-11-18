const {test}=require('node:test'); const assert=require('node:assert/strict');
test('collapsed companion docks at upper right and expanded panel stays visible',()=>{
  const {boundsFor}=require('../src/window.cjs');
  const area={x:0,y:0,width:1440,height:900};
  assert.deepEqual(boundsFor({x:1350,y:820},false,area),{x:1334,y:10,width:96,height:76});
  assert.deepEqual(boundsFor({x:1350,y:820},true,area),{x:1044,y:256,width:396,height:644});
});
test('unplugged display and small work area are clamped',()=>{
  const {boundsFor}=require('../src/window.cjs');
  assert.deepEqual(boundsFor({x:3000,y:-400},true,{x:0,y:0,width:320,height:480}),{x:0,y:0,width:320,height:480});
});
