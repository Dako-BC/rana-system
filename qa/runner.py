"""Main QA test runner."""

import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from qa.checks.business_logic import BusinessLogicChecker
from qa.checks.system import SystemHealthChecker, get_system_health_report
from qa.test_cases.generator import TestCaseGenerator, generate_edge_case_tests
from qa.validators.content import validate_content_quality
from qa.validators.schema import validate_agent_output


class QATestRunner:
    """Main QA automation runner."""

    def __init__(self, report_dir: str = "qa/reports"):
        self.report_dir = Path(report_dir)
        self.report_dir.mkdir(parents=True, exist_ok=True)
        self.results = {
            "timestamp": datetime.now().isoformat(),
            "tests": [],
            "summary": {
                "total": 0,
                "passed": 0,
                "failed": 0,
                "warnings": 0,
            },
        }

    def _record_result(self, result: Dict[str, Any]) -> None:
        self.results["tests"].append(result)
        if result["status"] == "passed":
            self.results["summary"]["passed"] += 1
        else:
            self.results["summary"]["failed"] += 1
        self.results["summary"]["total"] += 1

    def test_agent_output(
        self,
        agent_name: str,
        output: str,
        product_context: str = "",
        test_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Test one agent output against schema and content validation."""
        test_name = test_name or f"{agent_name}_{int(time.time())}"
        result = {
            "test_name": test_name,
            "agent": agent_name,
            "status": "passed",
            "timestamp": datetime.now().isoformat(),
            "checks": {
                "schema": {"passed": False, "errors": []},
                "content": {"passed": False, "errors": []},
            },
        }

        schema_valid, schema_errors = validate_agent_output(agent_name, output)
        result["checks"]["schema"]["passed"] = schema_valid
        result["checks"]["schema"]["errors"] = schema_errors
        if not schema_valid:
            result["status"] = "failed"

        content_valid, content_errors = validate_content_quality(
            agent_name, output, product_context
        )
        result["checks"]["content"]["passed"] = content_valid
        result["checks"]["content"]["errors"] = content_errors
        if not content_valid:
            result["status"] = "failed"

        result["system_health"] = get_system_health_report()
        return result

    def test_full_pipeline(
        self,
        product_context: str,
        hara_output: str,
        bombom_output: Optional[str] = None,
        luna_output: Optional[str] = None,
        rana_decision: Optional[str] = None,
        hagen_output: Optional[str] = None,
        test_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Test a complete workflow result."""
        test_name = test_name or f"pipeline_{int(time.time())}"
        start_time = time.time()

        result = {
            "test_name": test_name,
            "type": "full_pipeline",
            "status": "passed",
            "timestamp": datetime.now().isoformat(),
            "checks": {
                "individual_agents": {},
                "business_logic": {"passed": False, "errors": []},
                "system_health": {"passed": False, "errors": []},
            },
        }

        for agent_name, output in [
            ("hara", hara_output),
            ("bombom", bombom_output),
            ("luna", luna_output),
            ("rana_decision", rana_decision),
            ("hagen", hagen_output),
        ]:
            if not output:
                continue

            agent_result = self.test_agent_output(
                agent_name,
                output,
                product_context,
                f"{test_name}_{agent_name}",
            )
            result["checks"]["individual_agents"][agent_name] = agent_result
            if agent_result["status"] != "passed":
                result["status"] = "failed"

        skip_creative = bombom_output is None and luna_output is None
        logic_valid, logic_errors = BusinessLogicChecker.check_full_workflow_validity(
            hara_output,
            bombom_output,
            luna_output,
            rana_decision,
            hagen_output,
            skip_creative=skip_creative,
        )
        result["checks"]["business_logic"]["passed"] = logic_valid
        result["checks"]["business_logic"]["errors"] = logic_errors
        if not logic_valid:
            result["status"] = "failed"

        response_time = time.time() - start_time
        response_valid, response_errors = SystemHealthChecker.check_response_time(
            start_time, time.time(), max_seconds=120.0
        )
        memory_valid, memory_errors = SystemHealthChecker.check_memory_usage()
        disk_valid, disk_errors = SystemHealthChecker.check_disk_space(".")
        health_valid = response_valid and memory_valid and disk_valid
        health_errors = response_errors + memory_errors + disk_errors
        result["checks"]["system_health"]["passed"] = health_valid
        result["checks"]["system_health"]["errors"] = health_errors
        result["checks"]["system_health"]["response_time_seconds"] = response_time
        if not health_valid:
            result["status"] = "failed"

        return result

    def test_api_health(self, api_endpoint: str, test_name: str = "api_health") -> Dict[str, Any]:
        """Check that a backend health endpoint responds."""
        is_valid, errors = SystemHealthChecker.check_api_responsiveness(api_endpoint)
        result = {
            "test_name": test_name,
            "type": "api_health",
            "status": "passed" if is_valid else "failed",
            "timestamp": datetime.now().isoformat(),
            "checks": {
                "api": {
                    "passed": is_valid,
                    "errors": errors,
                    "endpoint": api_endpoint,
                }
            },
        }
        self._record_result(result)
        return result

    def run_random_tests(self, count: int = 5, verbose: bool = False) -> List[Dict[str, Any]]:
        """Run generated full-pipeline tests."""
        test_results = []
        for i in range(count):
            if verbose:
                print(f"Running generated test {i + 1}/{count}...")

            test_case = TestCaseGenerator.generate_full_pipeline_test()
            result = self.test_full_pipeline(
                product_context=test_case["product_context"],
                hara_output=test_case["hara"],
                bombom_output=test_case["bombom"],
                luna_output=test_case["luna"],
                rana_decision=test_case["rana_decision"],
                hagen_output=test_case["hagen"],
                test_name=f"generated_test_{i + 1}_{int(time.time())}",
            )
            test_results.append(result)
            self._record_result(result)

            if verbose:
                status_label = "PASS" if result["status"] == "passed" else "FAIL"
                print(f"  [{status_label}] {result['test_name']}: {result['status']}")

        return test_results

    def run_edge_case_tests(self, verbose: bool = False) -> List[Dict[str, Any]]:
        """Run edge case scenario tests."""
        test_results = []
        for edge_case in generate_edge_case_tests():
            if verbose:
                print(f"Running edge case: {edge_case['name']}...")

            test_data = TestCaseGenerator.generate_full_pipeline_test()
            if "product_context" in edge_case:
                test_data["product_context"] = edge_case["product_context"]
            if "hara" in edge_case:
                test_data["hara"] = edge_case["hara"]
                hara_data = json.loads(test_data["hara"])
                awareness_level = hara_data.get("awareness_level")
                test_data["bombom"] = TestCaseGenerator.generate_bombom_output(
                    awareness_level=awareness_level
                )
                test_data["luna"] = TestCaseGenerator.generate_luna_output(
                    awareness_level=awareness_level
                )
                test_data["rana_decision"] = TestCaseGenerator.generate_rana_decision(
                    test_data["bombom"],
                    test_data["luna"],
                )
                rana_data = json.loads(test_data["rana_decision"])
                test_data["hagen"] = (
                    TestCaseGenerator.generate_hagen_output()
                    if rana_data.get("run_hagen")
                    else None
                )

            result = self.test_full_pipeline(
                product_context=test_data["product_context"],
                hara_output=test_data["hara"],
                bombom_output=test_data["bombom"],
                luna_output=test_data["luna"],
                rana_decision=test_data["rana_decision"],
                hagen_output=test_data["hagen"],
                test_name=f"edge_case_{edge_case['name']}",
            )
            test_results.append(result)
            self._record_result(result)

            if verbose:
                status_label = "PASS" if result["status"] == "passed" else "FAIL"
                print(f"  [{status_label}] {edge_case['name']}: {result['status']}")

        return test_results

    def save_report(self, filename: Optional[str] = None) -> str:
        """Save test report to a JSON file."""
        if not filename:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"qa_report_{timestamp}.json"

        filepath = self.report_dir / filename
        with open(filepath, "w", encoding="utf-8") as file:
            json.dump(self.results, file, indent=2, ensure_ascii=False)
        return str(filepath)

    def print_summary(self) -> None:
        """Print test summary to console."""
        summary = self.results["summary"]
        total = summary["total"]
        passed = summary["passed"]
        failed = summary["failed"]

        print("\n" + "=" * 60)
        print("QA TEST SUMMARY")
        print("=" * 60)
        print(f"Total tests:  {total}")
        print(f"Passed:       {passed}")
        print(f"Failed:       {failed}")

        if total > 0:
            print(f"Pass rate:    {(passed / total) * 100:.1f}%")

        print("=" * 60 + "\n")

        if failed > 0:
            print("FAILED TESTS:")
            for test in self.results["tests"]:
                if test["status"] != "failed":
                    continue
                print(f"\n  FAIL {test['test_name']}")
                for check_result in test.get("checks", {}).values():
                    if isinstance(check_result, dict) and not check_result.get("passed", True):
                        errors = check_result.get("errors", [])
                        for error in errors[:3]:
                            print(f"    - {error}")
                        if len(errors) > 3:
                            print(f"    ... and {len(errors) - 3} more errors")


def build_arg_parser() -> argparse.ArgumentParser:
    """Build QA runner CLI parser."""
    parser = argparse.ArgumentParser(description="Run Rana QA checks.")
    parser.add_argument("--count", type=int, default=10, help="Number of generated pipeline tests.")
    parser.add_argument("--skip-edge", action="store_true", help="Skip edge case tests.")
    parser.add_argument(
        "--api-health",
        default="",
        help="Optional health endpoint to check, e.g. http://localhost:8000/health.",
    )
    parser.add_argument("--report-dir", default="qa/reports", help="Directory for JSON reports.")
    parser.add_argument("--no-report", action="store_true", help="Do not save a JSON report.")
    parser.add_argument("--quiet", action="store_true", help="Only print the final summary.")
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    """Main entry point for QA testing."""
    args = build_arg_parser().parse_args(argv)
    runner = QATestRunner(report_dir=args.report_dir)
    verbose = not args.quiet

    if verbose:
        print("Starting QA Automation Tests...\n")

    if args.count > 0:
        if verbose:
            print(f"Running {args.count} generated full-pipeline tests...")
        runner.run_random_tests(count=args.count, verbose=verbose)

    if not args.skip_edge:
        if verbose:
            print("\nRunning edge case tests...")
        runner.run_edge_case_tests(verbose=verbose)

    if args.api_health:
        if verbose:
            print(f"\nChecking API health: {args.api_health}")
        result = runner.test_api_health(args.api_health)
        if verbose:
            status_label = "PASS" if result["status"] == "passed" else "FAIL"
            print(f"  [{status_label}] api_health: {result['status']}")

    runner.print_summary()

    if not args.no_report:
        report_path = runner.save_report()
        print(f"Report saved to: {report_path}\n")

    return 0 if runner.results["summary"]["failed"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
