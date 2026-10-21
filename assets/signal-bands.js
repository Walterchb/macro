/** Descriptive operational filter, not a confidence interval or a predictive model.
 * For each indicator's own 3M-change history, the central band is the interpolated
 * 20th percentile of absolute changes in the preceding 60 calendar months (>=36
 * distinct monthly observations), excluding the evaluated observation. This makes
 * the smallest historical fifth neutral; choosing that fifth is a disclosed design
 * convention, not an estimate of economic significance. The rounding floor stops
 * a displayed zero from carrying a directional signal. Latest-vintage data do not
 * constitute a real-time backtest. Official policy thresholds are not altered.
 */
const finite = value => typeof value === 'number' && Number.isFinite(value);
const month = date => /^\d{4}-(0[1-9]|1[0-2])-01$/.test(date);
const shift = (date, amount) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + amount);
  return d.toISOString().slice(0,10);
};
const quantile = (sorted, q) => {
  const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};
const classify = (value, band, direction) => Math.abs(value) <= band ? 0 : Math.sign(value) * direction;

/** asOf optionally evaluates a historical cut without reading later observations.
 * Persistence reconstructs each exact month using only its preceding calibration
 * window, but uses today's revised history: it is NOT a real-time backtest.
 * Overlapping 3M windows are not independent observations.
 */
export function calibratedChangeSignal(history, {digits=2, direction=1, asOf=null}={}) {
  const empty = {value:null,band:null,sampleSize:0,startDate:null,endDate:null,persistence:0,sensitivity:null};
  if(![1,-1].includes(direction) || !Number.isInteger(digits) || digits<0 || digits>8) return empty;
  const rows=(history||[]).filter(o=>o && month(o.date) && finite(o.value) && (!asOf || o.date<=asOf)).slice().sort((a,b)=>a.date.localeCompare(b.date));
  // Ambiguous duplicated periods must not silently influence calibration.
  if(rows.some((o,i)=>i>0 && o.date===rows[i-1].date)) return empty;
  const point=rows.at(-1);
  if(!point) return empty;
  const at = point => {
    const lower=shift(point.date,-60), prior=rows.filter(o=>o.date>=lower && o.date<point.date);
    const result={...empty,sampleSize:prior.length,startDate:prior[0]?.date??null,endDate:prior.at(-1)?.date??null,date:point.date};
    if(prior.length<36) return result;
    const absolute=prior.map(o=>Math.abs(o.value)).sort((a,b)=>a-b);
    const floor=.5*10**(-digits), band=Math.max(floor,quantile(absolute,.2));
    const baseValue=classify(point.value,band,direction);
    const low=Math.max(floor,quantile(absolute,.1)), high=Math.max(floor,quantile(absolute,.3));
    const stable=classify(point.value,low,direction)===baseValue && classify(point.value,high,direction)===baseValue;
    // A direction sensitive to this explicitly chosen convention is not asserted.
    const sensitivity={lowBand:low,highBand:high,stable};
    return {...result,value:stable?baseValue:0,baseValue,band,sensitivity,sensitivityStable:stable};
  };
  const result=at(point);
  if(result.value===null) return result;
  const lookup=new Map(rows.map(o=>[o.date,o]));
  let persistence=0;
  for(let k=0;k<=60;k++) {
    const previous=lookup.get(shift(point.date,-k));
    if(!previous || at(previous).value!==result.value) break;
    persistence++;
  }
  return {...result,persistence};
}
