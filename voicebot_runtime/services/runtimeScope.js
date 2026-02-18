const constants = require("../constants");

const getRuntimeTag = () => String(constants.RUNTIME_TAG || "prod").trim() || "prod";
const getRuntimeFamily = () => {
    const fromConstants = String(constants.RUNTIME_FAMILY || "").trim().toLowerCase();
    if (fromConstants === "prod" || fromConstants === "dev") return fromConstants;

    const runtimeTag = getRuntimeTag().toLowerCase();
    if (runtimeTag === "prod" || runtimeTag === "production" || runtimeTag.startsWith("prod-")) {
        return "prod";
    }
    return "dev";
};
const isProdRuntime = () => constants.IS_PROD_RUNTIME === true || getRuntimeFamily() === "prod";

const buildRuntimeFilter = ({
    field = "runtime_tag",
    strict = false,
    includeLegacyInProd = false,
    familyMatch = false,
    runtimeTag = getRuntimeTag(),
    runtimeFamily = getRuntimeFamily(),
    prodRuntime = isProdRuntime(),
} = {}) => {
    if (strict) {
        return { [field]: runtimeTag };
    }

    if (familyMatch) {
        const familyFilter = [
            { [field]: { $regex: `^${runtimeFamily}(?:-|$)` } },
        ];
        if (prodRuntime && includeLegacyInProd) {
            familyFilter.push({ [field]: { $exists: false } });
            familyFilter.push({ [field]: null });
            familyFilter.push({ [field]: "" });
        }
        return familyFilter.length === 1 ? familyFilter[0] : { $or: familyFilter };
    }

    return { [field]: runtimeTag };
};

const mergeWithRuntimeFilter = (query = {}, options = {}) => {
    const runtimeFilter = buildRuntimeFilter(options);
    if (!query || Object.keys(query).length === 0) {
        return runtimeFilter;
    }
    return { $and: [query, runtimeFilter] };
};

const recordMatchesRuntime = (
    record,
    {
        field = "runtime_tag",
        strict = false,
        includeLegacyInProd = false,
        familyMatch = false,
        runtimeTag = getRuntimeTag(),
        runtimeFamily = getRuntimeFamily(),
        prodRuntime = isProdRuntime(),
    } = {}
) => {
    if (!record || typeof record !== "object") return false;
    const value = record[field];
    const normalized = typeof value === "string" ? value.trim() : value;

    if (strict) {
        return normalized === runtimeTag;
    }

    if (familyMatch) {
        if (typeof normalized === "string") {
            if (normalized === runtimeFamily || normalized.startsWith(`${runtimeFamily}-`)) {
                return true;
            }
            if (prodRuntime && includeLegacyInProd && normalized === "") {
                return true;
            }
            return false;
        }
        return prodRuntime && includeLegacyInProd && (normalized === undefined || normalized === null);
    }

    if (prodRuntime && includeLegacyInProd) {
        if (normalized === undefined || normalized === null || normalized === "") return true;
    }

    return normalized === runtimeTag;
};

module.exports = {
    getRuntimeTag,
    getRuntimeFamily,
    isProdRuntime,
    buildRuntimeFilter,
    mergeWithRuntimeFilter,
    recordMatchesRuntime,
};
