/*
 * JSON writing for the web frontend's exports: each object or array puts
 * the comma before every member after its first.
 */

#pragma once

#include <cstdio>
#include <string>
#include <string_view>
#include <vector>

/* A JSON string: quotes, backslashes and control characters escaped, bytes outside printable ASCII as \u00xx. */
inline void json_string(std::string &out, std::string_view s)
{
	out += '"';
	for (unsigned char c : s)
	{
		switch (c)
		{
		case '"': out += "\\\""; break;
		case '\\': out += "\\\\"; break;
		case '\n': out += "\\n"; break;
		case '\r': out += "\\r"; break;
		case '\t': out += "\\t"; break;
		default:
			if (c < 0x20 || c >= 0x7f)
			{
				char buf[8];
				snprintf(buf, sizeof(buf), "\\u%04x", c);
				out += buf;
			}
			else
			{
				out += static_cast<char>(c);
			}
		}
	}
	out += '"';
}

/* Writes JSON to a string: members of the innermost open object or array, keys before an object's members. */
class JsonWriter
{
public:
	explicit JsonWriter(std::string &out) : out_(out) {}

	JsonWriter &key(char const *key)
	{
		member();
		json_string(out_, key);
		out_ += ':';
		keyed_ = true;
		return *this;
	}

	void value(long value) { member(); out_ += std::to_string(value); }
	void value(std::string_view value) { member(); json_string(out_, value); }
	void field(char const *name, long value) { key(name).value(value); }
	void field(char const *name, std::string_view value) { key(name).value(value); }

	void begin_object() { open('{'); }
	void end_object() { close('}'); }
	void begin_array() { open('['); }
	void end_array() { close(']'); }

private:
	/* The comma before a member after the first, unless a key has just been written. */
	void member()
	{
		if (keyed_)
		{
			keyed_ = false;
			return;
		}
		if (empty_.empty()) return;
		if (!empty_.back()) out_ += ',';
		empty_.back() = false;
	}

	void open(char c) { member(); out_ += c; empty_.push_back(true); }
	void close(char c) { out_ += c; empty_.pop_back(); }

	std::string &out_;
	std::vector<bool> empty_;
	bool keyed_ = false;
};
