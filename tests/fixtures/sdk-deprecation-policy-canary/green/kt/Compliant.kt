// GREEN — names the version that removes it, and carries a mechanical ReplaceWith.
@Deprecated(
    message = "Use newThing() — oldThing will be removed in cmp-paycraft 3.0.0",
    replaceWith = ReplaceWith("newThing()"),
    level = DeprecationLevel.WARNING,
)
fun oldThing() = Unit
