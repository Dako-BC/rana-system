"""System health and performance checks."""

import time
import shutil
from typing import Dict, List, Tuple, Any

try:
    import psutil
except ImportError:  # pragma: no cover - depends on local environment
    psutil = None


class SystemHealthChecker:
    """Checks system health, performance, and resource usage."""

    @staticmethod
    def check_response_time(start_time: float, end_time: float, max_seconds: float = 60.0) -> Tuple[bool, List[str]]:
        """
        Check if response completed within acceptable time.

        Args:
            start_time: Unix timestamp when task started
            end_time: Unix timestamp when task ended
            max_seconds: Maximum acceptable duration

        Returns:
            (is_valid, error_messages)
        """
        errors = []
        elapsed = end_time - start_time

        if elapsed > max_seconds:
            errors.append(
                f"Response took {elapsed:.1f}s, exceeds limit of {max_seconds:.1f}s"
            )

        return len(errors) == 0, errors

    @staticmethod
    def check_memory_usage(max_percent: float = 85.0) -> Tuple[bool, List[str]]:
        """Check if system memory usage is acceptable."""
        errors = []

        try:
            if psutil is None:
                return True, []
            memory_percent = psutil.virtual_memory().percent

            if memory_percent > max_percent:
                errors.append(
                    f"System memory usage high: {memory_percent:.1f}% (limit: {max_percent:.1f}%)"
                )

        except Exception as e:
            errors.append(f"Cannot check memory: {str(e)}")

        return len(errors) == 0, errors

    @staticmethod
    def check_disk_space(path: str = ".", min_mb: float = 100) -> Tuple[bool, List[str]]:
        """Check if sufficient disk space is available."""
        errors = []

        try:
            usage = shutil.disk_usage(path)
            available_mb = usage.free / (1024 * 1024)

            if available_mb < min_mb:
                errors.append(
                    f"Low disk space: {available_mb:.1f}MB available (minimum required: {min_mb:.1f}MB)"
                )
        except Exception as e:
            errors.append(f"Cannot check disk space: {str(e)}")

        return len(errors) == 0, errors

    @staticmethod
    def check_api_responsiveness(api_endpoint: str, timeout: float = 5.0) -> Tuple[bool, List[str]]:
        """
        Check if backend API is responding.

        Args:
            api_endpoint: Full URL to test (e.g., http://localhost:8000/api/health)
            timeout: Timeout in seconds

        Returns:
            (is_responsive, error_messages)
        """
        errors = []

        try:
            import httpx

            with httpx.Client(timeout=timeout) as client:
                response = client.get(api_endpoint)

                if response.status_code >= 500:
                    errors.append(
                        f"API returned server error: {response.status_code}")
                elif response.status_code >= 400:
                    errors.append(
                        f"API returned error: {response.status_code}")

        except httpx.TimeoutException:
            errors.append(f"API request timed out after {timeout}s")
        except httpx.ConnectError:
            errors.append(f"Cannot connect to API at {api_endpoint}")
        except Exception as e:
            errors.append(f"API check failed: {str(e)}")

        return len(errors) == 0, errors

    @staticmethod
    def check_no_errors_in_execution(messages: List[Dict[str, str]]) -> Tuple[bool, List[str]]:
        """
        Check if execution messages contain error indicators.

        Args:
            messages: List of message dicts like {"role": "...", "content": "..."}

        Returns:
            (is_valid, error_messages)
        """
        errors = []
        error_indicators = [
            "error:",
            "exception:",
            "failed",
            "traceback",
            "not found",
            "invalid",
        ]

        for msg in messages:
            content = str(msg.get("content", "")).lower()

            for indicator in error_indicators:
                # Short messages likely errors
                if indicator in content and len(content) < 500:
                    errors.append(
                        f"Error detected in message: {msg.get('content', '')[:100]}")
                    break

        return len(errors) == 0, errors


def get_system_health_report() -> Dict[str, Any]:
    """Generate comprehensive system health report."""
    report = {
        "timestamp": time.time(),
        "memory": {},
        "disk": {},
        "process": {},
    }

    try:
        if psutil is None:
            report["memory"]["warning"] = "psutil is not installed"
        else:
            vm = psutil.virtual_memory()
            report["memory"] = {
                "total_mb": vm.total / (1024 * 1024),
                "available_mb": vm.available / (1024 * 1024),
                "percent": vm.percent,
            }
    except Exception as e:
        report["memory"]["error"] = str(e)

    try:
        usage = shutil.disk_usage(".")
        report["disk"] = {
            "total_mb": usage.total / (1024 * 1024),
            "available_mb": usage.free / (1024 * 1024),
        }
    except Exception as e:
        report["disk"]["error"] = str(e)

    try:
        if psutil is None:
            report["process"]["warning"] = "psutil is not installed"
        else:
            proc = psutil.Process()
            report["process"] = {
                "memory_mb": proc.memory_info().rss / (1024 * 1024),
                "cpu_percent": proc.cpu_percent(interval=0.1),
            }
    except Exception as e:
        report["process"]["error"] = str(e)

    return report
