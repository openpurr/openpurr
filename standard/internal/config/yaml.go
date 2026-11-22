package config

import (
	"errors"
	"fmt"
	"math"
	"os"
	"regexp"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"

	"github.com/openpurr/openpurr/standard/internal/jsobj"
)

// ParseYAML reads an openpurr.config.yaml (or JSON, which is YAML) into the values Lite's build
// step gets from the `yaml` package: YAML 1.2 core schema, so `yes` is a string and timestamps
// stay strings. An empty file is null.
func ParseYAML(data []byte) (any, error) {
	var doc yaml.Node
	if err := yaml.Unmarshal(data, &doc); err != nil {
		return nil, err
	}
	if doc.Kind == 0 || len(doc.Content) == 0 {
		return nil, nil
	}
	return yamlValue(doc.Content[0], 0)
}

// LoadFile reads and validates a config file. Errors read like Lite's build-config script:
// "<path>: YAML syntax error" or the path followed by the problems.
func LoadFile(path string) (any, *Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, nil, fmt.Errorf("no config at %s (OPENPURR_CONFIG): %w", path, err)
	}
	raw, err := ParseYAML(data)
	if err != nil {
		return nil, nil, fmt.Errorf("%s: YAML syntax error\n%s", path, err)
	}
	cfg, err := Parse(raw)
	if err != nil {
		var ce *Error
		if errors.As(err, &ce) {
			return nil, nil, fmt.Errorf("%s\n%s", path, ce.Error())
		}
		return nil, nil, err
	}
	return raw, cfg, nil
}

var (
	coreNull   = regexp.MustCompile(`^(?:~|null|Null|NULL)?$`)
	coreBool   = regexp.MustCompile(`^(?:true|True|TRUE|false|False|FALSE)$`)
	coreInt    = regexp.MustCompile(`^[-+]?[0-9]+$`)
	coreOct    = regexp.MustCompile(`^0o[0-7]+$`)
	coreHex    = regexp.MustCompile(`^0x[0-9a-fA-F]+$`)
	coreFloat  = regexp.MustCompile(`^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?$`)
	coreInf    = regexp.MustCompile(`^[-+]?\.(?:inf|Inf|INF)$`)
	coreNaN    = regexp.MustCompile(`^\.(?:nan|NaN|NAN)$`)
	errTooDeep = errors.New("YAML nested too deeply")
)

func yamlValue(n *yaml.Node, depth int) (any, error) {
	if depth > 200 {
		return nil, errTooDeep
	}
	switch n.Kind {
	case yaml.DocumentNode:
		if len(n.Content) == 0 {
			return nil, nil
		}
		return yamlValue(n.Content[0], depth+1)
	case yaml.AliasNode:
		return yamlValue(n.Alias, depth+1)
	case yaml.MappingNode:
		o := jsobj.New()
		for i := 0; i+1 < len(n.Content); i += 2 {
			k, v := n.Content[i], n.Content[i+1]
			key, err := yamlValue(k, depth+1)
			if err != nil {
				return nil, err
			}
			val, err := yamlValue(v, depth+1)
			if err != nil {
				return nil, err
			}
			o.Set(jsobj.String(key, true), val)
		}
		return o, nil
	case yaml.SequenceNode:
		arr := make([]any, 0, len(n.Content))
		for _, c := range n.Content {
			v, err := yamlValue(c, depth+1)
			if err != nil {
				return nil, err
			}
			arr = append(arr, v)
		}
		return arr, nil
	case yaml.ScalarNode:
		if n.Style&yaml.TaggedStyle != 0 {
			switch n.ShortTag() {
			case "!!str":
				return n.Value, nil
			case "!!null":
				return nil, nil
			}
		}
		if n.Style&(yaml.DoubleQuotedStyle|yaml.SingleQuotedStyle|yaml.LiteralStyle|yaml.FoldedStyle) != 0 {
			return n.Value, nil
		}
		return coreScalar(n.Value), nil
	}
	return nil, fmt.Errorf("unsupported YAML node at line %d", n.Line)
}

// coreScalar resolves a plain scalar with the YAML 1.2 core schema.
func coreScalar(s string) any {
	switch {
	case coreNull.MatchString(s):
		return nil
	case coreBool.MatchString(s):
		return strings.ToLower(s) == "true"
	case coreInt.MatchString(s):
		return jsobj.ParseNumber(s)
	case coreOct.MatchString(s):
		v, err := strconv.ParseUint(s[2:], 8, 64)
		if err != nil {
			return math.Inf(1)
		}
		return float64(v)
	case coreHex.MatchString(s):
		v, err := strconv.ParseUint(s[2:], 16, 64)
		if err != nil {
			return math.Inf(1)
		}
		return float64(v)
	case coreFloat.MatchString(s):
		return jsobj.ParseNumber(s)
	case coreInf.MatchString(s):
		if strings.HasPrefix(s, "-") {
			return math.Inf(-1)
		}
		return math.Inf(1)
	case coreNaN.MatchString(s):
		return math.NaN()
	}
	return s
}
