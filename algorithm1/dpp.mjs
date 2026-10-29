function normalize(vector) {
  const length = Math.hypot(...vector);
  return length === 0 ? vector.map(() => 0) : vector.map((value) => value / length);
}

function determinant(matrix) {
  const a = matrix.map((row) => [...row]);
  let result = 1;
  for (let i = 0; i < a.length; i++) {
    let pivot = i;
    for (let j = i + 1; j < a.length; j++) {
      if (Math.abs(a[j][i]) > Math.abs(a[pivot][i])) pivot = j;
    }
    if (Math.abs(a[pivot][i]) < 1e-12) return 0;
    if (pivot !== i) {
      [a[i], a[pivot]] = [a[pivot], a[i]];
      result *= -1;
    }
    result *= a[i][i];
    for (let j = i + 1; j < a.length; j++) {
      const factor = a[j][i] / a[i][i];
      for (let k = i + 1; k < a.length; k++) a[j][k] -= factor * a[i][k];
    }
  }
  return result;
}

export function buildDppKernel(tasks) {
  const epsilon = 0.1;
  const theta = 0.7;
  const alpha = theta / (2 * (1 - theta));
  const embeddings = tasks.map((task) => normalize(task.embedding));
  const qualities = tasks.map((task) => Math.max(task.difficulty / 10, epsilon));
  const maxQuality = Math.max(...qualities);
  const weights = qualities.map((quality) => (quality / maxQuality) ** alpha);
  return tasks.map((_, i) => tasks.map((_, j) => {
    const similarity = embeddings[i].reduce((sum, value, index) => sum + value * embeddings[j][index], 0);
    return weights[i] * weights[j] * similarity;
  }));
}

export function selectCoreset(tasks, size = 10) {
  const kernel = buildDppKernel(tasks);
  const selected = [];
  while (selected.length < Math.min(size, tasks.length)) {
    let best = null;
    for (let index = 0; index < tasks.length; index++) {
      if (selected.includes(index)) continue;
      const subset = [...selected, index];
      const score = determinant(subset.map((row) => subset.map((column) => kernel[row][column])));
      if (!best || score > best.score) best = { index, score };
    }
    selected.push(best.index);
  }
  return selected.map((index) => tasks[index]);
}
