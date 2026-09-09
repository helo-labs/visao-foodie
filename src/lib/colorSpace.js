// Conversões de espaço de cor.
//
// Por que LAB e não RGB: em RGB, a distância numérica entre duas cores não
// corresponde ao quanto o olho as vê como diferentes. LAB é perceptualmente
// uniforme, então "contraste" e "saturação" medidos nele batem com o que a
// pessoa realmente percebe na foto.

const D65 = { x: 95.047, y: 100.0, z: 108.883 };

// sRGB vem com correção gama embutida; desfaz antes de qualquer conta linear.
export function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function rgbToXyz(r, g, b) {
  const R = srgbToLinear(r) * 100;
  const G = srgbToLinear(g) * 100;
  const B = srgbToLinear(b) * 100;
  return {
    x: R * 0.4124 + G * 0.3576 + B * 0.1805,
    y: R * 0.2126 + G * 0.7152 + B * 0.0722,
    z: R * 0.0193 + G * 0.1192 + B * 0.9505,
  };
}

const pivot = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

export function rgbToLab(r, g, b) {
  const { x, y, z } = rgbToXyz(r, g, b);
  const fx = pivot(x / D65.x);
  const fy = pivot(y / D65.y);
  const fz = pivot(z / D65.z);
  return {
    L: 116 * fy - 16,        // 0..100
    a: 500 * (fx - fy),      // verde -> vermelho
    b: 200 * (fy - fz),      // azul  -> amarelo
  };
}

// Croma em LAB: distância do eixo neutro. É a medida de saturação que usamos,
// mais fiel que o S do HSV, que satura demais em tons escuros.
export function labChroma(lab) {
  return Math.sqrt(lab.a * lab.a + lab.b * lab.b);
}

export function rgbToHsv(r, g, b) {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

// Luminância Rec. 709, o peso por canal que corresponde à sensibilidade do olho.
export function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
