export function validate(schema, property = "body") {
  return (req, res, next) => {
    const result = schema.safeParse(req[property]);
    if (!result.success) {
      return res.status(400).json({
        error: result.error.issues.map((issue) => issue.message).join(", "),
        issues: result.error.issues,
      });
    }
    req[property] = result.data;
    next();
  };
}
