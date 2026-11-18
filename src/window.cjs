function dockAnchor(area){return {x:area.x+area.width-396-10,y:area.y+10};}
function boundsFor(anchor,expanded,area) {
  const width=Math.min(expanded?396:96,area.width),height=Math.min(expanded?644:76,area.height);
  if(!expanded)return {x:area.x+area.width-width-10,y:area.y+10,width,height};
  return {x:Math.round(Math.max(area.x,Math.min(anchor.x,area.x+area.width-width))),y:Math.round(Math.max(area.y,Math.min(anchor.y,area.y+area.height-height))),width,height};
}
module.exports={boundsFor,dockAnchor};
