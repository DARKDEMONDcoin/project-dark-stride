REVOKE EXECUTE ON FUNCTION public.get_shared_output(text) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.get_shared_output(text) TO service_role;