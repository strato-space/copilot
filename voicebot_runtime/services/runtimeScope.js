const constants = require("../constants");

const getRuntimeTag = () => String(constants.RUNTIME_TAG || "prod").trim() || "prod";
const isProdRuntime = () => constants.IS_PROD_RUNTIME === true || getRuntimeTag() === "prod";

const buildRuntimeFilter = ({
    field = "runtime_tag",
    strict = false,
    includeLegacyInProd = true,
    runtimeTag = getRuntimeTag(),
    prodRuntime = isProdRuntime(),
} = {}) => {
    if (strict) {
        return { [field]: runtimeTag };
    }

    if (prodRuntime && includeLegacyInProd) {
        return {
            $or: [
                { [field]: runtimeTag },
                { [field]: { $exists: false } },
                { [field]: null },
                { [field]: "" },
            ],
        };
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
        includeLegacyInProd = true,
        runtimeTag = getRuntimeTag(),
        prodRuntime = isProdRuntime(),
    } = {}
) => {
    if (!record || typeof record !== "object") return false;
    const value = record[field];
    const normalized = typeof value === "string" ? value.trim() : value;

    if (strict) {
        return normalized === runtimeTag;
    }

    if (prodRuntime && includeLegacyInProd) {
        if (normalized === undefined || normalized === null || normalized === "") return true;
    }

    return normalized === runtimeTag;
};

module.exports = {
    getRuntimeTag,
    isProdRuntime,
    buildRuntimeFilter,
    mergeWithRuntimeFilter,
    recordMatchesRuntime,
};

