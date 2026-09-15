// RED — a deprecation with no stated removal version. This is the shape that let
// `PayCraft.configure {}` disappear between v1.0.0 and v2.0 without warning anyone.
@Deprecated(
    message = "Superseded by somethingElse(). Use that instead.",
    level = DeprecationLevel.WARNING,
)
fun oldThing() = Unit
