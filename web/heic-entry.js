// فك صور HEIC/HEIF (آيفون وبعض أجهزة أندرويد). بيتبني لـ public/heic.js وبيتحمّل عند الحاجة بس (حوالي 2 ميجا).
import libheif from 'libheif-js/wasm-bundle';
window.lrHeicDecode = async (buf) => {
  const dec = new libheif.HeifDecoder();
  const imgs = dec.decode(new Uint8Array(buf));
  if (!imgs || !imgs.length) throw Error('heic: no image');
  const im = imgs[0], w = im.get_width(), h = im.get_height();
  if (!w || !h || w * h > 120e6) throw Error('heic: bad size');
  const id = new ImageData(w, h);
  await new Promise((ok, no) => im.display(id, (r) => (r ? ok() : no(Error('heic: display failed')))));
  return id;
};
