/*
 * Web (Emscripten) frontend for ToME 2.
 *
 * Copyright (c) 1997 Ben Harrison, and others
 *
 * This software may be copied and distributed for educational, research,
 * and not for profit purposes provided that this copyright and statement
 * are included in all such copies.
 */

#include "config.hpp"
#include "main.hpp"
#include "frontend.hpp"
#include "util.hpp"
#include "variable.hpp"
#include "z-term.hpp"
#include "z-util.hpp"

#include <emscripten.h>
#include <pwd.h>

#include <cerrno>
#include <ctime>
#include <memory>

/*
 * Home directory; "~/.tome" beneath it is persisted to IndexedDB.
 */
#define WEB_HOME_DIR "/home/web_user"

/*
 * JavaScript bridge. The receiving side lives in web/src/engine.ts and is
 * attached to Module.tome before the runtime starts.
 */

EM_ASYNC_JS(void, web_mount_storage, (const char *path_ptr), {
	const path = UTF8ToString(path_ptr);
	FS.mkdirTree(path);
	FS.mount(IDBFS, { autoPersist: false }, path);
	const error = await new Promise((resolve) => {
		FS.syncfs(true, (err) => resolve(err || null));
	});
	if (error) {
		console.error('IDBFS load failed', error);
		Module.tome.storageError = String(error);
	}
	Module.tome.storagePath = path;
});

EM_ASYNC_JS(int, web_wait_key, (), {
	return await Module.tome.waitKey();
});

EM_JS(int, web_poll_key, (), {
	return Module.tome.pollKey();
});

EM_JS(void, web_draw_text, (int x, int y, int n, int a, const char *s), {
	Module.tome.drawText(x, y, a, HEAPU8.subarray(s, s + n));
});

EM_JS(void, web_draw_cursor, (int x, int y), {
	Module.tome.drawCursor(x, y);
});

EM_JS(void, web_clear, (), {
	Module.tome.clear();
});

EM_JS(void, web_flush, (), {
	Module.tome.flush();
});

EM_JS(void, web_effect_frame, (), {
	Module.tome.effectFrame();
});

EM_JS(void, web_bell, (), {
	Module.tome.bell();
});

EM_JS(void, web_set_title, (const char *s, int n), {
	Module.tome.setTitle(UTF8ToString(s, n));
});

EM_JS(void, web_set_colour, (int i, int r, int g, int b), {
	Module.tome.setColour(i, r, g, b);
});

EM_JS(void, web_quit, (const char *s), {
	Module.tome.quit(s ? UTF8ToString(s) : null);
});

/*
 * Milliseconds between forced yields to the browser while the game runs
 * without waiting for input (resting, running, level generation).
 */
static constexpr double YIELD_INTERVAL_MS = 50.0;

static double last_yield_ms = 0.0;

static void maybe_yield()
{
	double now = emscripten_get_now();

	if (now - last_yield_ms >= YIELD_INTERVAL_MS)
	{
		emscripten_sleep(0);
		last_yield_ms = emscripten_get_now();
	}
}

/*
 * Asynchronous replacement for nanosleep() (std::this_thread::sleep_for).
 */
extern "C" int __wrap_nanosleep(const struct timespec *req, struct timespec *rem)
{
	if (!req || req->tv_nsec < 0 || req->tv_nsec >= 1000000000L || req->tv_sec < 0)
	{
		errno = EINVAL;
		return -1;
	}

	unsigned int ms = static_cast<unsigned int>(req->tv_sec * 1000 + req->tv_nsec / 1000000L);

	web_effect_frame();
	emscripten_sleep(ms);
	last_yield_ms = emscripten_get_now();

	if (rem)
	{
		rem->tv_sec = 0;
		rem->tv_nsec = 0;
	}

	return 0;
}

/*
 * Replacement for getpwuid(): user "PLAYER" with home WEB_HOME_DIR.
 */
extern "C" struct passwd *__wrap_getpwuid(uid_t)
{
	static char name[] = "PLAYER";
	static char password[] = "";
	static char gecos[] = "";
	static char shell[] = "/bin/sh";
	static char home[] = WEB_HOME_DIR;
	static struct passwd entry = {
		name, password, 0, 0, gecos, home, shell
	};

	return &entry;
}

static void send_palette()
{
	for (int i = 0; i < 256; i++)
	{
		web_set_colour(i,
		               angband_color_table[i][1],
		               angband_color_table[i][2],
		               angband_color_table[i][3]);
	}
}

class WebFrontend final : public Frontend {

private:
	static bool enqueue_pending_keys()
	{
		bool any = false;

		for (int k = web_poll_key(); k >= 0; k = web_poll_key())
		{
			Term_keypress(k);
			any = true;
		}

		return any;
	}

public:
	void init() final
	{
		web_clear();
	}

	void nuke() final
	{
		web_flush();
	}

	void process_event(bool wait) final
	{
		if (enqueue_pending_keys())
		{
			return;
		}

		if (wait)
		{
			Term_keypress(web_wait_key());
			last_yield_ms = emscripten_get_now();
			enqueue_pending_keys();
		}
		else
		{
			maybe_yield();
			enqueue_pending_keys();
		}
	}

	bool soft_cursor() const final
	{
		return true;
	}

	bool icky_corner() const final
	{
		return false;
	}

	void flush_events() final
	{
		enqueue_pending_keys();
	}

	void process_queued_events() final
	{
		// Keys are delivered on demand by process_event()
	}

	void clear() final
	{
		web_clear();
	}

	void flush_output() final
	{
		web_flush();
	}

	void noise() final
	{
		web_bell();
	}

	void react() final
	{
		send_palette();
	}

	void rename_main_window(std::string_view name) final
	{
		web_set_title(name.data(), static_cast<int>(name.size()));
	}

	void draw_cursor(int x, int y) final
	{
		web_draw_cursor(x, y);
	}

	void draw_text(int x, int y, int n, byte a, const char *s) final
	{
		web_draw_text(x, y, n, a, s);
	}
};

/*
 * Off-screen terminal that swallows drawing, so engine text routines can be
 * run for the web UI without touching the visible screen.
 */
class NullFrontend final : public Frontend {

public:
	void init() final { }
	void nuke() final { }
	void process_event(bool) final { }
	bool soft_cursor() const final { return true; }
	bool icky_corner() const final { return false; }
	void flush_events() final { }
	void process_queued_events() final { }
	void clear() final { }
	void flush_output() final { }
	void noise() final { }
	void react() final { }
	void rename_main_window(std::string_view) final { }
	void draw_cursor(int, int) final { }
	void draw_text(int, int, int, byte, const char *) final { }
};

static term *scratch_term = nullptr;
static term *saved_term = nullptr;

void web_scratch_term_begin()
{
	if (!scratch_term)
	{
		scratch_term = term_init(80, 24, 16, std::make_shared<NullFrontend>());
	}

	saved_term = Term;
	Term_activate(scratch_term);
}

void web_scratch_term_end()
{
	Term_activate(saved_term);
	saved_term = nullptr;
}

static void (*previous_quit_aux)(const char *) = nullptr;

static void hook_quit(const char *str)
{
	if (previous_quit_aux)
	{
		(*previous_quit_aux)(str);
	}

	web_quit(str);
}

static int init_web(int argc, char *argv[])
{
	previous_quit_aux = quit_aux;
	quit_aux = hook_quit;

	send_palette();

	term *t = term_init(80, 24, 1024, std::make_shared<WebFrontend>());

	if (!t)
	{
		return -1;
	}

	Term_activate(t);
	angband_term[0] = t;

	return 0;
}

int main(int argc, char *argv[])
{
	char storage[1024];

	path_parse(storage, sizeof(storage), PRIVATE_USER_PATH);
	web_mount_storage(storage);

	last_yield_ms = emscripten_get_now();

	return main_real(argc, argv, "web", init_web, "");
}
