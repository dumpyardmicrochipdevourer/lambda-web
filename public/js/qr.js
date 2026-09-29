// byte mode, error correction M, versions 1-10; matrices checked against a reference encoder
export function qrMatrix(text) {
  var VER=[null,[26,10,[16]],[44,16,[28]],[70,26,[44]],[100,18,[32,32]],[134,24,[43,43]],
    [172,16,[27,27,27,27]],[196,18,[31,31,31,31]],[242,22,[38,38,39,39]],
    [292,22,[36,36,36,37,37]],[346,26,[43,43,43,43,44]]];
  var ALIGN=[null,[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50]];
  var EXP=new Uint8Array(512),LOG=new Uint8Array(256);
  for(var i=0,x=1;i<255;i++){EXP[i]=x;LOG[x]=i;x<<=1;if(x&0x100)x^=0x11d;}
  for(i=255;i<512;i++)EXP[i]=EXP[i-255];
  function mul(a,b){return(a===0||b===0)?0:EXP[LOG[a]+LOG[b]];}
  function genPoly(n){var g=[1];for(var i=0;i<n;i++){var ng=new Array(g.length+1).fill(0);
    for(var j=0;j<g.length;j++){ng[j]^=g[j];ng[j+1]^=mul(g[j],EXP[i]);}g=ng;}return g;}
  function ecBytes(data,n){var g=genPoly(n),rem=new Array(n).fill(0);
    for(var i=0;i<data.length;i++){var f=data[i]^rem[0];rem.shift();rem.push(0);
      for(var j=0;j<n;j++)rem[j]^=mul(g[j+1],f);}return rem;}
  var bytes=[],enc=unescape(encodeURIComponent(text));
  for(i=0;i<enc.length;i++)bytes.push(enc.charCodeAt(i)&0xff);
  var version=0;
  for(var v=1;v<=10;v++){var cap=VER[v][2].reduce(function(a,b){return a+b;},0);
    if(cap*8>=4+(v<10?8:16)+bytes.length*8){version=v;break;}}
  if(!version)throw new Error('QR: too much data');
  var spec=VER[version],ecLen=spec[1],blockSizes=spec[2];
  var dataLen=blockSizes.reduce(function(a,b){return a+b;},0);
  var bits=[];
  function push(val,len){for(var i=len-1;i>=0;i--)bits.push((val>>i)&1);}
  push(4,4);push(bytes.length,version<10?8:16);
  for(i=0;i<bytes.length;i++)push(bytes[i],8);
  for(i=0;i<4&&bits.length<dataLen*8;i++)bits.push(0);
  while(bits.length%8)bits.push(0);
  var words=[];
  for(i=0;i<bits.length;i+=8){var b=0;for(var k=0;k<8;k++)b=(b<<1)|bits[i+k];words.push(b);}
  var pad=[0xec,0x11],p=0;while(words.length<dataLen)words.push(pad[p++%2]);
  var dB=[],eB=[],off=0;
  for(i=0;i<blockSizes.length;i++){var blk=words.slice(off,off+blockSizes[i]);off+=blockSizes[i];
    dB.push(blk);eB.push(ecBytes(blk,ecLen));}
  var out=[],maxD=Math.max.apply(null,blockSizes);
  for(i=0;i<maxD;i++)for(var q=0;q<dB.length;q++)if(i<dB[q].length)out.push(dB[q][i]);
  for(i=0;i<ecLen;i++)for(q=0;q<eB.length;q++)out.push(eB[q][i]);
  var stream=[];
  for(i=0;i<out.length;i++)for(k=7;k>=0;k--)stream.push((out[i]>>k)&1);
  var size=version*4+17,m=[],res=[];
  for(i=0;i<size;i++){m.push(new Array(size).fill(0));res.push(new Array(size).fill(0));}
  function setF(r,c,val){m[r][c]=val;res[r][c]=1;}
  function finder(r,c){for(var dr=-1;dr<=7;dr++)for(var dc=-1;dc<=7;dc++){
    var rr=r+dr,cc=c+dc;if(rr<0||rr>=size||cc<0||cc>=size)continue;
    var inner=dr>=0&&dr<=6&&dc>=0&&dc<=6;
    var on=inner&&(dr===0||dr===6||dc===0||dc===6||(dr>=2&&dr<=4&&dc>=2&&dc<=4));
    setF(rr,cc,on?1:0);}}
  finder(0,0);finder(0,size-7);finder(size-7,0);
  var ap=ALIGN[version];
  for(i=0;i<ap.length;i++)for(var j=0;j<ap.length;j++){var ar=ap[i],ac=ap[j];
    if((ar<=7&&ac<=7)||(ar<=7&&ac>=size-8)||(ar>=size-8&&ac<=7))continue;
    for(var dr2=-2;dr2<=2;dr2++)for(var dc2=-2;dc2<=2;dc2++)
      setF(ar+dr2,ac+dc2,Math.max(Math.abs(dr2),Math.abs(dc2))!==1?1:0);}
  for(i=8;i<size-8;i++){setF(6,i,i%2===0?1:0);setF(i,6,i%2===0?1:0);}
  setF(size-8,8,1);
  for(i=0;i<9;i++){if(!res[8][i])setF(8,i,0);if(!res[i][8])setF(i,8,0);}
  for(i=0;i<8;i++){if(!res[8][size-1-i])setF(8,size-1-i,0);if(!res[size-1-i][8])setF(size-1-i,8,0);}
  if(version>=7)for(i=0;i<6;i++)for(j=0;j<3;j++){setF(i,size-11+j,0);setF(size-11+j,i,0);}
  var idx=0,up=true;
  for(var col=size-1;col>0;col-=2){
    if(col===6)col--;
    for(var n=0;n<size;n++){var row=up?size-1-n:n;
      for(var s=0;s<2;s++){var cc2=col-s;if(res[row][cc2])continue;
        m[row][cc2]=idx<stream.length?stream[idx]:0;idx++;}}
    up=!up;}
  function maskFn(k,r,c){switch(k){
    case 0:return(r+c)%2===0;case 1:return r%2===0;case 2:return c%3===0;
    case 3:return(r+c)%3===0;case 4:return(Math.floor(r/2)+Math.floor(c/3))%2===0;
    case 5:return(r*c)%2+(r*c)%3===0;case 6:return((r*c)%2+(r*c)%3)%2===0;
    default:return((r+c)%2+(r*c)%3)%2===0;}}
  function fmtBits(mask){var data=mask,d=data<<10;
    for(var i=14;i>=10;i--)if((d>>i)&1)d^=0x537<<(i-10);
    return((data<<10)|d)^0x5412;}
  function verBits(ver){var d=ver<<12;
    for(var i=17;i>=12;i--)if((d>>i)&1)d^=0x1f25<<(i-12);return(ver<<12)|d;}
  function penalty(g){var score=0,i,j,run,cur;
    for(i=0;i<size;i++){
      run=1;cur=g[i][0];
      for(j=1;j<size;j++){if(g[i][j]===cur)run++;else{if(run>=5)score+=run-2;cur=g[i][j];run=1;}}
      if(run>=5)score+=run-2;
      run=1;cur=g[0][i];
      for(j=1;j<size;j++){if(g[j][i]===cur)run++;else{if(run>=5)score+=run-2;cur=g[j][i];run=1;}}
      if(run>=5)score+=run-2;}
    for(i=0;i<size-1;i++)for(j=0;j<size-1;j++){var a=g[i][j];
      if(a===g[i][j+1]&&a===g[i+1][j]&&a===g[i+1][j+1])score+=3;}
    var p1=[1,0,1,1,1,0,1,0,0,0,0],p2=[0,0,0,0,1,0,1,1,1,0,1];
    function mt(arr,at,pat){for(var k=0;k<11;k++)if(arr[at+k]!==pat[k])return false;return true;}
    for(i=0;i<size;i++){var rw=g[i],cl=[];
      for(j=0;j<size;j++)cl.push(g[j][i]);
      for(j=0;j+11<=size;j++){
        if(mt(rw,j,p1)||mt(rw,j,p2))score+=40;
        if(mt(cl,j,p1)||mt(cl,j,p2))score+=40;}}
    var dark=0;for(i=0;i<size;i++)for(j=0;j<size;j++)dark+=g[i][j];
    score+=Math.floor(Math.abs(dark*100/(size*size)-50)/5)*10;
    return score;}
  function build(mask){
    var g=[];for(var i=0;i<size;i++)g.push(m[i].slice());
    for(i=0;i<size;i++)for(var j=0;j<size;j++)if(!res[i][j]&&maskFn(mask,i,j))g[i][j]^=1;
    var fb=fmtBits(mask);
    for(i=0;i<15;i++){var bit=(fb>>i)&1;
      if(i<6)g[i][8]=bit;else if(i<8)g[i+1][8]=bit;else g[size-15+i][8]=bit;
      if(i<8)g[8][size-1-i]=bit;else if(i<9)g[8][15-i]=bit;else g[8][14-i]=bit;}
    g[size-8][8]=1;
    if(version>=7){var vb=verBits(version);
      for(i=0;i<18;i++){var b2=(vb>>i)&1;
        g[Math.floor(i/3)][size-11+(i%3)]=b2;g[size-11+(i%3)][Math.floor(i/3)]=b2;}}
    return g;}
  var best=null,bestScore=Infinity;
  for(var mk=0;mk<8;mk++){var g2=build(mk),sc=penalty(g2);
    if(sc<bestScore){bestScore=sc;best=g2;}}
  return best;
}

export function qrSvg(text, label, quiet = 2) {
  const m = qrMatrix(text), n = m.length, s = n + quiet * 2;
  let d = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++)
    if (m[y][x]) d += 'M' + (x + quiet) + ' ' + (y + quiet) + 'h1v1h-1z';
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + s + ' ' + s +
    '" shape-rendering="crispEdges" role="img" aria-label="' + label + '">' +
    '<rect width="' + s + '" height="' + s + '" fill="#fff"/>' +
    '<path d="' + d + '" fill="#000"/></svg>';
}
