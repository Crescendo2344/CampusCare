-- Pin the search path (Supabase advisor: function_search_path_mutable).
alter function private.html_escape(text) set search_path = '';
