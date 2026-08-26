/**
 * Check if some object is empty: undefined, null, {}
 * @param {*} obj
 * @returns true when the object is empty, false when is not,
 * undefined if obj is not an object (NaN, 0, '')
 */
const isEmpty = (obj) => {
  let result = undefined;

  if (
    obj == null ||
    obj == undefined ||
    (obj.constructor === Object && Object.keys(obj).length === 0)
  ) {
    result = true;
  }

  return result;
};

module.exports = {
  isEmpty,
};
